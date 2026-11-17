import type { ReviewFinding, Severity } from "../core/review/finding";
import type { ReviewReport } from "../core/review/report";

const RESET = "\x1b[0m";
const STYLES: Record<Severity, string> = {
  critical: "\x1b[1;97;41m",
  high: "\x1b[1;31m",
  medium: "\x1b[1;33m",
  low: "\x1b[1;36m",
};

export interface TerminalOptions {
  color: boolean;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function renderTerminal(report: ReviewReport, options: TerminalOptions): string {
  const paint = (style: string, text: string) => (options.color ? `${style}${text}${RESET}` : text);
  const dim = (text: string) => paint("\x1b[2m", text);
  const bold = (text: string) => paint("\x1b[1m", text);
  const out: string[] = [];

  out.push(bold(`Review ${report.id}: ${report.target.label}`));
  if (report.target.instruction) out.push(dim(`Instruction: ${report.target.instruction}`));
  const { bySeverity, totalFindings, filesReviewed, filesSkipped } = report.summary;
  out.push(
    dim(
      `${filesReviewed} file(s) reviewed, ${filesSkipped} skipped | model ${report.model.name} | ${(report.stats.durationMs / 1000).toFixed(1)}s`,
    ),
  );
  out.push("");

  if (totalFindings === 0) {
    out.push(paint("\x1b[32m", "No issues found."));
  } else {
    out.push(
      bold(`${totalFindings} finding(s): `) +
        (["critical", "high", "medium", "low"] as const)
          .filter((s) => bySeverity[s] > 0)
          .map((s) => paint(STYLES[s], `${bySeverity[s]} ${s}`))
          .join(", "),
    );
    out.push("");
    report.findings.forEach((f, i) => out.push(renderFinding(f, i + 1, paint, dim, bold), ""));
  }

  for (const warning of report.warnings) out.push(paint("\x1b[33m", `warning: ${warning}`));
  return out.join("\n").trimEnd();
}

function renderFinding(
  f: ReviewFinding,
  index: number,
  paint: (style: string, text: string) => string,
  dim: (text: string) => string,
  bold: (text: string) => string,
): string {
  const lines = [
    `${index}. ${paint(STYLES[f.severity], ` ${f.severity.toUpperCase()} `)} ${bold(f.title)} ${dim(`[${f.category}, ${Math.round(f.confidence * 100)}%]`)}`,
    `   ${f.filePath}:${f.startLine}${f.endLine > f.startLine ? `-${f.endLine}` : ""}`,
  ];
  if (f.description) lines.push(indent(f.description, "   "));
  if (f.evidence) lines.push(`   ${dim("Evidence:")}`, indent(f.evidence, "     "));
  if (f.suggestion) lines.push(`   ${dim("Suggestion:")}`, indent(f.suggestion, "     "));
  for (const r of f.related ?? []) lines.push(dim(`   Also: ${r.filePath}:${r.startLine}-${r.endLine}`));
  lines.push(dim(`   id: ${f.id}`));
  return lines.join("\n");
}
