import { GitAnalyzer } from "../../analyzers/git-analyzer";
import { prompts, renderPrompt } from "../../prompts";
import { numberLines, splitLines } from "../../util/text";
import { createSource } from "../context/source";
import type { Runtime } from "../runtime";
import type { ReviewFinding } from "./finding";
import type { ReviewReport } from "./report";

const PAD = 30;

export async function explainFinding(
  runtime: Runtime,
  report: ReviewReport,
  finding: ReviewFinding,
  signal?: AbortSignal,
): Promise<string> {
  const { config } = runtime;
  const git = await GitAnalyzer.open(runtime.root);
  const scope = report.target.ref ? ({ kind: "ref", ref: report.target.ref } as const) : ({ kind: "worktree" } as const);
  const source = createSource(git, scope, { maxFileBytes: config.review.maxFileBytes, ignore: config.review.ignore });
  const content = await source.read(finding.filePath);
  const lines = content === null ? [] : splitLines(content);
  const start = Math.max(1, finding.startLine - PAD);
  const end = Math.min(lines.length, finding.endLine + PAD);
  const excerpt = lines.length > 0 ? numberLines(lines.slice(start - 1, end), start) : "(file content unavailable)";

  const user = [
    "## Finding",
    JSON.stringify(finding, null, 2),
    `## Code at ${finding.filePath}:${start}-${end}`,
    excerpt,
  ].join("\n\n");

  const result = await runtime.provider().complete({
    system: renderPrompt(prompts.explain, { language: config.review.language }),
    messages: [{ role: "user", content: user }],
    signal,
  });
  return result.text.trim();
}
