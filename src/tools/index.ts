import { gitDiffTool } from "./git-diff";
import { readFileTool } from "./read-file";
import { runChecksTool } from "./run-checks";
import { searchCodeTool } from "./search-code";
import type { AgentTool, ToolContext } from "./tool";
import { truncate } from "../util/text";

const MAX_OUTPUT_CHARS = 12_000;

export interface Toolbox {
  describe(): string;
  has(name: string): boolean;
  call(name: string, args: unknown): Promise<string>;
}

export function createToolbox(context: ToolContext): Toolbox {
  const tools: AgentTool[] = [readFileTool, searchCodeTool, gitDiffTool, runChecksTool].filter((t) => t.enabled(context));
  return {
    describe: () => tools.map((t) => `- ${t.signature}\n  ${t.description}`).join("\n"),
    has: (name) => tools.some((t) => t.name === name),
    async call(name, args) {
      const tool = tools.find((t) => t.name === name);
      if (!tool) return `Unknown tool "${name}". Available: ${tools.map((t) => t.name).join(", ")}`;
      try {
        return truncate(await tool.invoke(args, context), MAX_OUTPUT_CHARS);
      } catch (error) {
        return `Error: ${(error as Error).message}`;
      }
    },
  };
}

export type { AgentTool, ToolContext } from "./tool";
