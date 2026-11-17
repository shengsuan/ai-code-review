import type { Command } from "commander";
import { explainFinding } from "../../core/review/explain";
import { createRuntime } from "../../core/runtime";
import { CrvError } from "../../errors";
import { type OutputFormat, outputFormats, renderReport } from "../../output";

export function registerHistory(program: Command): void {
  program
    .command("history")
    .description("List saved reviews")
    .option("-n, --limit <n>", "number of reviews to show", "20")
    .option("-C, --cwd <dir>", "repository directory", process.cwd())
    .action(async (options: { limit: string; cwd: string }) => {
      const runtime = await createRuntime(options.cwd);
      const items = await runtime.store.list(Number.parseInt(options.limit, 10) || 20);
      if (items.length === 0) {
        process.stdout.write("No saved reviews\n");
        return;
      }
      for (const item of items) {
        process.stdout.write(`${item.id}  ${item.createdAt}  ${String(item.totalFindings).padStart(3)} finding(s)  ${item.label}\n`);
      }
    });

  program
    .command("show <reviewId>")
    .description('Show a saved review ("latest" for the most recent)')
    .option("-f, --format <format>", `output format: ${outputFormats.join(" | ")}`, "terminal")
    .option("-C, --cwd <dir>", "repository directory", process.cwd())
    .action(async (reviewId: string, options: { format: string; cwd: string }) => {
      if (!(outputFormats as readonly string[]).includes(options.format)) throw new CrvError(`Unknown format: ${options.format}`);
      const runtime = await createRuntime(options.cwd);
      const report = await runtime.store.get(reviewId);
      process.stdout.write(`${renderReport(report, options.format as OutputFormat, { color: process.stdout.isTTY === true && !process.env.NO_COLOR })}\n`);
    });

  program
    .command("explain <findingId>")
    .description("Explain a finding in depth")
    .option("--review <reviewId>", "review that contains the finding (default: search recent reviews)")
    .option("-C, --cwd <dir>", "repository directory", process.cwd())
    .action(async (findingId: string, options: { review?: string; cwd: string }) => {
      const runtime = await createRuntime(options.cwd);
      const found = await runtime.store.findFinding(findingId, options.review);
      if (!found) throw new CrvError(`Finding not found: ${findingId}`, 1);
      process.stdout.write(`${await explainFinding(runtime, found.report, found.finding)}\n`);
    });
}
