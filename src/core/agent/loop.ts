import { z } from "zod";
import type { LLMProvider } from "../../providers";
import type { Toolbox } from "../../tools";
import { logger } from "../../util/logger";
import { extractJson } from "../../util/json";
import { throwIfAborted } from "../../util/signal";

export class UsageMeter {
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;

  record(usage?: { inputTokens: number; outputTokens: number }): void {
    this.calls++;
    this.inputTokens += usage?.inputTokens ?? 0;
    this.outputTokens += usage?.outputTokens ?? 0;
  }
}

const toolCallsSchema = z.object({
  tool_calls: z
    .array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) }))
    .min(1),
});

const MAX_CALLS_PER_TURN = 4;

export interface LoopOptions {
  provider: LLMProvider;
  system: string;
  user: string;
  toolbox: Toolbox;
  maxToolSteps: number;
  meter: UsageMeter;
  signal?: AbortSignal;
}

export async function runAgentLoop(options: LoopOptions): Promise<unknown> {
  const { provider, toolbox, meter, signal } = options;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [{ role: "user", content: options.user }];
  let toolRounds = 0;
  let repairs = 0;

  for (let turn = 0; turn < options.maxToolSteps + 3; turn++) {
    throwIfAborted(signal);
    const response = await provider.complete({ system: options.system, messages, signal });
    meter.record(response.usage);

    const parsed = extractJson(response.text);
    if (parsed === undefined) {
      if (repairs++ >= 1) return undefined;
      messages.push({ role: "assistant", content: response.text });
      messages.push({ role: "user", content: "Your reply was not a valid JSON object. Reply again with exactly one JSON object and nothing else." });
      continue;
    }

    const calls = toolCallsSchema.safeParse(parsed);
    if (!calls.success) return parsed;

    messages.push({ role: "assistant", content: response.text });
    if (toolRounds >= options.maxToolSteps) {
      messages.push({ role: "user", content: "The tool budget is exhausted. Reply with the final JSON object now, without tool_calls." });
      continue;
    }
    toolRounds++;

    const results: string[] = [];
    for (const call of calls.data.tool_calls.slice(0, MAX_CALLS_PER_TURN)) {
      logger.debug({ tool: call.name, arguments: call.arguments }, "tool call");
      const output = await toolbox.call(call.name, call.arguments);
      results.push(`### ${call.name}(${JSON.stringify(call.arguments)})\n${output}`);
    }
    messages.push({ role: "user", content: `Tool results:\n\n${results.join("\n\n")}\n\nContinue. Call more tools or reply with the final JSON object.` });
  }
  return undefined;
}
