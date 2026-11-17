import { promises as fs } from "node:fs";
import type { Command } from "commander";
import type { ReviewTarget } from "../../analyzers/git-analyzer";
import { CrvError } from "../../errors";
import { type ReviewRequest, ReviewOrchestrator } from "../../core/review/orchestrator";
import { severities, severityRank, type Severity } from "../../core/review/finding";
import { createRuntime } from "../../core/runtime";
import { type OutputFormat, outputFormats, renderReport } from "../../output";

interface ReviewOptions {
  staged?: boolean;
  base?: string;
  head?: string;
  commit?: string;
  file?: string;
  custom?: string;
  rules?: string[];
  format: string;
  output?: string;
  minConfidence?: number;
  verify: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  failOn?: string;
  cwd: string;
  quiet?: boolean;
}

function resolveTarget(options: ReviewOptions): ReviewTarget {
  const chosen = [options.staged, options.base, options.commit, options.file].filter(Boolean).length;
  if (chosen > 1) throw new CrvError("Choose only one of --staged, --base, --commit, --file");
  if (options.head && !options.base) throw new CrvError("--head requires --base");
  if (options.staged) return { kind: "staged" };
  if (options.base) return { kind: "range", base: options.base, head: options.head };
  if (options.commit) return { kind: "commit", commit: options.commit };
  if (options.file) return { kind: "file", filePath: options.file };
  return { kind: "workspace" };
}

function parseConfidence(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new CrvError("--min-confidence must be between 0 and 1");
  return n;
}

export function registerReview(program: Command): void {
  program
    .command("review")
    .description("Review code changes (default: staged, unstaged and untracked changes in the working tree)")
    .option("--staged", "review the staged changes")
    .option("--base <ref>", "review the current branch against a base ref")
    .option("--head <ref>", "head ref for --base (default HEAD)")
    .option("--commit <sha>", "review the changes introduced by a commit")
    .option("--file <path>", "review a whole file")
    .option("--custom <instruction>", "custom review instruction that steers the review")
    .option("--rules <rule...>", "extra review rules: rule file paths or inline text")
    .option("-f, --format <format>", `output format: ${outputFormats.join(" | ")}`, "terminal")
    .option("-o, --output <file>", "write the report to a file")
    .option("--min-confidence <n>", "minimum confidence of reported findings (0-1)", parseConfidence)
    .option("--no-verify", "skip the verification stage")
    .option("--provider <type>", "provider type override")
    .option("--model <name>", "model override")
    .option("--base-url <url>", "provider base URL override")
    .option("--fail-on <severity>", `exit with code 1 if a finding of this severity or higher exists (${severities.join(" | ")})`)
    .option("-C, --cwd <dir>", "repository directory", process.cwd())
    .option("-q, --quiet", "suppress progress output")
    .action(async (options: ReviewOptions, command: Command) => {
      if (!(outputFormats as readonly string[]).includes(options.format)) throw new CrvError(`Unknown format: ${options.format}`);
      if (options.failOn && !(severities as readonly string[]).includes(options.failOn)) throw new CrvError(`Unknown severity: ${options.failOn}`);
      const target = resolveTarget(options);
      const verifyFromCli = command.getOptionValueSource("verify") === "cli";

      const runtime = await createRuntime(options.cwd, {
        provider: { type: options.provider, model: options.model, baseUrl: options.baseUrl },
        review: { minConfidence: options.minConfidence, verify: verifyFromCli ? options.verify : undefined },
      });

      const controller = new AbortController();
      const onSigint = () => controller.abort(new CrvError("Interrupted", 130));
      process.once("SIGINT", onSigint);
      const request: ReviewRequest = { target, instruction: options.custom, rules: options.rules };
      const orchestrator = new ReviewOrchestrator(runtime, {
        signal: controller.signal,
        onProgress: options.quiet ? undefined : (message) => process.stderr.write(`${message}\n`),
      });

      try {
        const report = await orchestrator.run(request);
        const color = !options.output && process.stdout.isTTY === true && !process.env.NO_COLOR;
        const rendered = renderReport(report, options.format as OutputFormat, { color });
        if (options.output) await fs.writeFile(options.output, `${rendered}\n`);
        else process.stdout.write(`${rendered}\n`);

        if (options.failOn) {
          const threshold = severityRank[options.failOn as Severity];
          if (report.findings.some((f) => severityRank[f.severity] >= threshold)) process.exitCode = 1;
        }
      } finally {
        process.off("SIGINT", onSigint);
      }
    });
}
