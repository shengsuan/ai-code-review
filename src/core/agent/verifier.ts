import { z } from "zod";
import { renderFileDiff } from "../../analyzers/diff-analyzer";
import { prompts, withProtocol } from "../../prompts";
import { mapPool } from "../../util/pool";
import { splitLines, numberLines } from "../../util/text";
import { logger } from "../../util/logger";
import { type ReviewFinding, severities, severityRank } from "../review/finding";
import { renderRules } from "../review/rules";
import { type AgentDeps, createAgentToolbox } from "./review-agent";
import { runAgentLoop } from "./loop";

const verdictSchema = z.object({
  verdict: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["confirmed", "rejected", "uncertain"])),
  confidence: z.preprocess((v) => {
    const n = typeof v === "string" ? Number.parseFloat(v) : v;
    return typeof n === "number" && n > 1 && n <= 100 ? n / 100 : n;
  }, z.number().min(0).max(1)),
  reason: z.string().default(""),
  severity: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(severities)).optional(),
});

const SNIPPET_PAD = 25;
const MAX_VERIFY_STEPS = 4;

export interface VerificationOutcome {
  findings: ReviewFinding[];
  rejected: number;
  verified: number;
  warnings: string[];
}

export class Verifier {
  constructor(private readonly deps: AgentDeps) {}

  async verify(findings: ReviewFinding[], signal?: AbortSignal): Promise<VerificationOutcome> {
    const { config } = this.deps;
    const ranked = [...findings].sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.confidence - a.confidence);
    const toVerify = new Set(ranked.slice(0, config.review.maxVerifications).map((f) => f.id));
    const warnings: string[] = [];
    let rejected = 0;
    let verified = 0;

    const results = await mapPool(findings, config.review.concurrency, async (finding): Promise<ReviewFinding | null> => {
      if (!toVerify.has(finding.id)) return finding;
      try {
        const outcome = await this.verifyOne(finding, signal);
        if (!outcome) {
          warnings.push(`verification of "${finding.title}" returned no usable result; kept unverified`);
          return finding;
        }
        verified++;
        if (outcome.verdict === "rejected") {
          rejected++;
          logger.debug({ id: finding.id, reason: outcome.reason }, "finding rejected by verifier");
          return null;
        }
        return {
          ...finding,
          severity: outcome.severity ?? finding.severity,
          confidence: outcome.verdict === "uncertain" ? Math.min(outcome.confidence, 0.5) : outcome.confidence,
          verification: { verdict: outcome.verdict, reason: outcome.reason },
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        warnings.push(`verification of "${finding.title}" failed: ${(error as Error).message}`);
        return finding;
      }
    });
    return { findings: results.filter((f): f is ReviewFinding => f !== null), rejected, verified, warnings };
  }

  private async verifyOne(finding: ReviewFinding, signal?: AbortSignal): Promise<z.infer<typeof verdictSchema> | null> {
    const { config, source, diffs, meter, provider } = this.deps;
    const toolbox = createAgentToolbox(this.deps, signal);
    const content = await source.read(finding.filePath);
    const lines = content === null ? [] : splitLines(content);
    const start = Math.max(1, finding.startLine - SNIPPET_PAD);
    const end = Math.min(lines.length, finding.endLine + SNIPPET_PAD);
    const snippet = lines.length > 0 ? numberLines(lines.slice(start - 1, end), start) : "(file content unavailable)";
    const diff = diffs.get(finding.filePath);
    const rules = renderRules(this.deps.rules, [finding.filePath]);

    const user = [
      "## Candidate finding",
      JSON.stringify(
        {
          title: finding.title,
          severity: finding.severity,
          category: finding.category,
          filePath: finding.filePath,
          startLine: finding.startLine,
          endLine: finding.endLine,
          description: finding.description,
          evidence: finding.evidence,
          suggestion: finding.suggestion,
        },
        null,
        2,
      ),
      `## Code at ${finding.filePath}:${start}-${end}`,
      snippet,
      ...(diff ? ["## Change to this file", renderFileDiff(diff)] : []),
      ...(rules ? ["## Project review rules", rules] : []),
      "Verify the finding now.",
    ].join("\n\n");

    const value = await runAgentLoop({
      provider,
      system: withProtocol(prompts.verification, toolbox.describe(), { language: config.review.language }),
      user,
      toolbox,
      maxToolSteps: Math.min(config.review.maxToolSteps, MAX_VERIFY_STEPS),
      meter,
      signal,
    });
    const parsed = verdictSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
}
