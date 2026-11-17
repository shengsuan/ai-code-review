import { z } from "zod";
import { defineTool } from "./tool";

export const searchCodeTool = defineTool({
  name: "search_code",
  signature: 'search_code({"pattern": string, "glob"?: string, "ignoreCase"?: boolean, "maxResults"?: number})',
  description: "Search the repository with an extended regular expression. Optional glob limits files, for example src/**/*.ts.",
  schema: z.object({
    pattern: z.string().min(1),
    glob: z.string().optional(),
    ignoreCase: z.boolean().optional(),
    maxResults: z.coerce.number().int().min(1).max(100).optional(),
  }),
  async run(args, context) {
    const hits = await context.source.search(args.pattern, {
      glob: args.glob,
      ignoreCase: args.ignoreCase,
      maxResults: args.maxResults ?? 30,
    });
    if (hits.length === 0) return "No matches";
    return hits.map((h) => `${h.path}:${h.line}: ${h.text.trim().slice(0, 200)}`).join("\n");
  },
});
