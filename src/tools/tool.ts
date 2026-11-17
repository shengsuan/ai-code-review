import type { z } from "zod";
import type { FileDiff } from "../analyzers/diff-analyzer";
import type { Config } from "../config/schema";
import type { CodeSource } from "../core/context/source";

export interface ToolContext {
  source: CodeSource;
  root: string;
  diffs: ReadonlyMap<string, FileDiff>;
  config: Config;
  signal?: AbortSignal;
}

export interface AgentTool {
  name: string;
  signature: string;
  description: string;
  enabled(context: ToolContext): boolean;
  invoke(args: unknown, context: ToolContext): Promise<string>;
}

interface ToolDefinition<S extends z.ZodTypeAny> {
  name: string;
  signature: string;
  description: string;
  schema: S;
  enabled?: (context: ToolContext) => boolean;
  run: (args: z.infer<S>, context: ToolContext) => Promise<string>;
}

export function defineTool<S extends z.ZodTypeAny>(definition: ToolDefinition<S>): AgentTool {
  return {
    name: definition.name,
    signature: definition.signature,
    description: definition.description,
    enabled: definition.enabled ?? (() => true),
    async invoke(args, context) {
      const parsed = definition.schema.safeParse(args);
      if (!parsed.success) {
        return `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}`;
      }
      return definition.run(parsed.data, context);
    },
  };
}
