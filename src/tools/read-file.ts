import { z } from "zod";
import { numberLines, splitLines } from "../util/text";
import { defineTool } from "./tool";

const MAX_LINES = 300;

export const readFileTool = defineTool({
  name: "read_file",
  signature: 'read_file({"path": string, "startLine"?: number, "endLine"?: number})',
  description: `Read a repository file with line numbers (at most ${MAX_LINES} lines per call).`,
  schema: z.object({
    path: z.string().min(1),
    startLine: z.coerce.number().int().min(1).optional(),
    endLine: z.coerce.number().int().min(1).optional(),
  }),
  async run(args, context) {
    const content = await context.source.read(args.path);
    if (content === null) return `File not found or unreadable: ${args.path}`;
    const lines = splitLines(content);
    if (lines.length === 0) return `${args.path} is empty`;
    const start = Math.min(args.startLine ?? 1, lines.length);
    const end = Math.min(args.endLine ?? start + MAX_LINES - 1, start + MAX_LINES - 1, lines.length);
    return `${args.path} lines ${start}-${end} of ${lines.length}\n${numberLines(lines.slice(start - 1, end), start)}`;
  },
});
