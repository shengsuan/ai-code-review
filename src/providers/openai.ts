import { z } from "zod";
import { ProviderError } from "../errors";
import { logger } from "../util/logger";
import { postJson } from "./http";
import type { CompletionRequest, CompletionResult, LLMProvider, ProviderSettings } from "./provider";

const chatResponse = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.union([z.string(), z.array(z.object({ text: z.string().optional() }).passthrough())]).nullish(),
              })
              .passthrough(),
            finish_reason: z.string().nullish(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

const responsesResponse = z
  .object({
    output_text: z.string().optional(),
    output: z
      .array(
        z
          .object({
            type: z.string().optional(),
            content: z.array(z.object({ type: z.string().optional(), text: z.string().optional() }).passthrough()).optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).passthrough().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export function authHeaders(settings: ProviderSettings): Record<string, string> {
  return {
    ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
    ...settings.headers,
  };
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown, provider: string): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new ProviderError(`Unexpected ${provider} response shape: ${result.error.issues[0]?.message ?? "unknown"}`);
  return result.data;
}

export class OpenAIChatProvider implements LLMProvider {
  readonly name: string = "openai-chat";
  protected readonly tokenField: string = "max_completion_tokens";

  constructor(protected readonly settings: ProviderSettings) {}

  get model(): string {
    return this.settings.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const s = this.settings;
    const body: Record<string, unknown> = {
      model: s.model,
      messages: [{ role: "system", content: request.system }, ...request.messages],
      [this.tokenField]: request.maxOutputTokens ?? s.maxOutputTokens,
    };
    if (s.temperature !== undefined) body.temperature = s.temperature;
    if (s.jsonMode) body.response_format = { type: "json_object" };

    const started = Date.now();
    const data = parse(chatResponse, await postJson(`${s.baseUrl}/chat/completions`, {
      headers: authHeaders(s),
      body,
      timeoutMs: s.timeoutMs,
      maxRetries: s.maxRetries,
      signal: request.signal,
    }), this.name);

    const choice = data.choices[0];
    const content = choice?.message.content;
    const text = typeof content === "string" ? content : (content ?? []).map((part) => part.text ?? "").join("");
    if (!text.trim()) throw new ProviderError(`Empty response from ${this.name} (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
    logger.debug({ provider: this.name, ms: Date.now() - started }, "completion finished");
    return {
      text,
      stopReason: choice?.finish_reason ?? undefined,
      usage: data.usage ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 } : undefined,
    };
  }
}

export class OpenAIResponsesProvider implements LLMProvider {
  readonly name = "openai-responses";

  constructor(private readonly settings: ProviderSettings) {}

  get model(): string {
    return this.settings.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const s = this.settings;
    const body: Record<string, unknown> = {
      model: s.model,
      instructions: request.system,
      input: request.messages.map((m) => ({ role: m.role, content: m.content })),
      max_output_tokens: request.maxOutputTokens ?? s.maxOutputTokens,
      store: false,
    };
    if (s.temperature !== undefined) body.temperature = s.temperature;
    if (s.jsonMode) body.text = { format: { type: "json_object" } };

    const data = parse(responsesResponse, await postJson(`${s.baseUrl}/responses`, {
      headers: authHeaders(s),
      body,
      timeoutMs: s.timeoutMs,
      maxRetries: s.maxRetries,
      signal: request.signal,
    }), this.name);

    const text =
      data.output_text ??
      (data.output ?? [])
        .flatMap((item) => (item.type === undefined || item.type === "message" ? (item.content ?? []) : []))
        .filter((part) => part.type === undefined || part.type === "output_text")
        .map((part) => part.text ?? "")
        .join("");
    if (!text.trim()) throw new ProviderError(`Empty response from ${this.name} (status: ${data.status ?? "unknown"})`);
    return {
      text,
      stopReason: data.status,
      usage: data.usage ? { inputTokens: data.usage.input_tokens ?? 0, outputTokens: data.usage.output_tokens ?? 0 } : undefined,
    };
  }
}
