import type { ProviderConfig, ProviderType } from "../config/schema";
import { ConfigError } from "../errors";
import { AnthropicProvider } from "./anthropic";
import { CompatibleProvider } from "./compatible";
import { OpenAIChatProvider, OpenAIResponsesProvider } from "./openai";
import type { LLMProvider, ProviderSettings } from "./provider";

const DEFAULT_BASE_URL: Record<ProviderType, string | undefined> = {
  "openai-chat": "https://api.openai.com/v1",
  "openai-responses": "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  compatible: undefined,
};

const DEFAULT_KEY_ENV: Record<ProviderType, string> = {
  "openai-chat": "OPENAI_API_KEY",
  "openai-responses": "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  compatible: "CRV_API_KEY",
};

export function createProvider(config: ProviderConfig, env: NodeJS.ProcessEnv = process.env): LLMProvider {
  if (!config.model) throw new ConfigError("No model configured. Run `crv config init` or set CRV_MODEL.");
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL[config.type];
  if (!baseUrl) throw new ConfigError(`provider.baseUrl is required for provider type "${config.type}"`);
  const keyEnv = config.apiKeyEnv ?? DEFAULT_KEY_ENV[config.type];
  const apiKey = config.apiKey ?? env[keyEnv] ?? env.CRV_API_KEY;
  if (!apiKey && config.type !== "compatible") {
    throw new ConfigError(`No API key found. Set ${keyEnv} (or CRV_API_KEY) or provider.apiKey.`);
  }
  const settings: ProviderSettings = {
    model: config.model,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    jsonMode: config.jsonMode,
    headers: config.headers,
  };
  switch (config.type) {
    case "openai-chat":
      return new OpenAIChatProvider(settings);
    case "openai-responses":
      return new OpenAIResponsesProvider(settings);
    case "anthropic":
      return new AnthropicProvider(settings);
    case "compatible":
      return new CompatibleProvider(settings);
  }
}

export type { ChatMessage, CompletionRequest, CompletionResult, LLMProvider, TokenUsage } from "./provider";
