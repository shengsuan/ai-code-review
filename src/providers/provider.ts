export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  usage?: TokenUsage;
  stopReason?: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export interface ProviderSettings {
  model: string;
  apiKey?: string;
  baseUrl: string;
  maxOutputTokens: number;
  temperature?: number;
  timeoutMs: number;
  maxRetries: number;
  jsonMode: boolean;
  headers: Record<string, string>;
}
