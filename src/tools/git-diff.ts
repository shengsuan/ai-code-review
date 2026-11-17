import { z } from "zod";
import { renderFileDiff } from "../analyzers/diff-analyzer";
import { defineTool } from "./tool";

export const gitDiffTool = defineTool({
  name: "git_diff",
  signature: 'git_diff({"path"?: string})',
  description: "Show the diff of one changed file, or list all changed files when path is omitted.",
  schema: z.object({ path: z.string().optional() }),
  async run(args, context) {
    if (!args.path) {
      return [...context.diffs.values()].map((f) => `${f.path} (${f.status}, +${f.additions} -${f.deletions})`).join("\n") || "No changes";
    }
    const file = context.diffs.get(args.path);
    return file ? renderFileDiff(file) : `No diff for ${args.path}`;
  },
});
