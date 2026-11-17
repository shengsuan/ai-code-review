import { ProviderError } from "../errors";
import { logger } from "../util/logger";
import { anySignal, sleep } from "../util/signal";

export interface PostOptions {
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  maxRetries: number;
  signal?: AbortSignal;
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(500 * 2 ** attempt + Math.random() * 250, 15_000);
}

export async function postJson(url: string, options: PostOptions): Promise<unknown> {
  let lastError: ProviderError | undefined;
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("Aborted");
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = anySignal([options.signal, timeout]);
    let retryAfter: string | null = null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify(options.body),
        signal,
      });
      retryAfter = response.headers.get("retry-after");
      const text = await response.text();
      if (!response.ok) {
        const retryable = [408, 409, 425, 429].includes(response.status) || response.status >= 500;
        throw new ProviderError(`HTTP ${response.status} from ${new URL(url).host}: ${text.slice(0, 500)}`, response.status, retryable);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ProviderError(`Invalid JSON response from ${new URL(url).host}: ${text.slice(0, 200)}`, response.status, true);
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      if (error instanceof ProviderError) lastError = error;
      else if (timeout.aborted) lastError = new ProviderError(`Request timed out after ${options.timeoutMs}ms`, undefined, true);
      else lastError = new ProviderError(`Network error: ${(error as Error).message}`, undefined, true);
      if (!lastError.retryable || attempt === options.maxRetries) throw lastError;
      const delay = retryDelay(attempt, retryAfter);
      logger.warn({ attempt: attempt + 1, delay, error: lastError.message }, "provider request failed, retrying");
      await sleep(delay, options.signal);
    }
  }
  throw lastError ?? new ProviderError("Request failed");
}
