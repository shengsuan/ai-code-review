import { z } from "zod";
import { ProviderError } from "../errors";
import { postJson } from "./http";
import type { CompletionRequest, CompletionResult, LLMProvider, ProviderSettings } from "./provider";

const messagesResponse = z
  .object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
    stop_reason: z.string().nullish(),
    usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

function messagesUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/messages")) return baseUrl;
  return baseUrl.endsWith("/v1") ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  constructor(private readonly settings: ProviderSettings) {}

  get model(): string {
    return this.settings.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const s = this.settings;
    const body: Record<string, unknown> = {
      model: s.model,
      system: request.system,
      messages: request.messages,
      max_tokens: request.maxOutputTokens ?? s.maxOutputTokens,
    };
    if (s.temperature !== undefined) body.temperature = s.temperature;

    const raw = await postJson(messagesUrl(s.baseUrl), {
      headers: {
        ...(s.apiKey ? { "x-api-key": s.apiKey } : {}),
        "anthropic-version": "2023-06-01",
        ...s.headers,
      },
      body,
      timeoutMs: s.timeoutMs,
      maxRetries: s.maxRetries,
      signal: request.signal,
    });
    const parsed = messagesResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError("Unexpected anthropic response shape");
    const text = parsed.data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (!text.trim()) throw new ProviderError(`Empty response from anthropic (stop_reason: ${parsed.data.stop_reason ?? "unknown"})`);
    const usage = parsed.data.usage;
    return {
      text,
      stopReason: parsed.data.stop_reason ?? undefined,
      usage: usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined,
    };
  }
}
