import { GitAnalyzer, type ReviewTarget } from "../../analyzers/git-analyzer";
import { filterDiffs, parseDiff } from "../../analyzers/diff-analyzer";
import { type ReportStats, type ReviewReport, buildReport } from "./report";
import { errorMessage } from "../../errors";
import { mapPool } from "../../util/pool";
import { anySignal } from "../../util/signal";
import { UsageMeter } from "../agent/loop";
import { type AgentDeps, ReviewAgent } from "../agent/review-agent";
import { planReview } from "../agent/review-planner";
import { Verifier } from "../agent/verifier";
import { createSource } from "../context/source";
import type { Runtime } from "../runtime";
import { type ReviewFinding, dedupeFindings } from "./finding";
import { loadRules, scopeDiffs } from "./rules";

export interface ReviewRequest {
  target: ReviewTarget;
  instruction?: string;
  rules?: string[];
}

export interface OrchestratorOptions {
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

const VERIFY_FLOOR = 0.4;

export class ReviewOrchestrator {
  constructor(
    private readonly runtime: Runtime,
    private readonly options: OrchestratorOptions = {},
  ) {}

  private progress(message: string): void {
    this.options.onProgress?.(message);
  }

  async run(request: ReviewRequest): Promise<ReviewReport> {
    const { root, config, store } = this.runtime;
    const review = config.review;
    const started = Date.now();
    const signal = anySignal([this.options.signal, AbortSignal.timeout(review.reviewTimeoutMs)]);
    const warnings: string[] = [];
    const meter = new UsageMeter();

    const provider = this.runtime.provider();
    const rules = await loadRules(root, review.rulesFiles, request.rules);
    const git = await GitAnalyzer.open(root);
    this.progress("Collecting changes");
    const resolution = await git.resolveTarget(request.target, { maxFileBytes: review.maxFileBytes });
    const filtered = filterDiffs(parseDiff(resolution.diff), review.ignore);
    const scoped = scopeDiffs(rules, filtered.kept);
    const kept = scoped.kept;
    const skipped = [...filtered.skipped, ...scoped.skipped];

    const reportTarget = {
      mode: resolution.mode,
      label: resolution.label,
      ref: resolution.scope.kind === "ref" ? resolution.scope.ref : undefined,
      instruction: request.instruction,
    };
    const model = { provider: provider.name, name: provider.model };
    const finish = async (findings: ReviewFinding[], extra: Partial<ReportStats>): Promise<ReviewReport> => {
      const report = buildReport({
        target: reportTarget,
        model,
        findings,
        skipped,
        warnings,
        filesReviewed: kept.length,
        stats: {
          durationMs: Date.now() - started,
          llmCalls: meter.calls,
          inputTokens: meter.inputTokens,
          outputTokens: meter.outputTokens,
          candidates: 0,
          verified: 0,
          rejected: 0,
          ...extra,
        },
      });
      await store.save(report);
      return report;
    };

    if (kept.length === 0) {
      warnings.push("No reviewable changes found");
      return finish([], {});
    }

    const diffs = new Map(kept.map((f) => [f.path, f]));
    const source = createSource(git, resolution.scope, { maxFileBytes: review.maxFileBytes, ignore: review.ignore });
    const deps: AgentDeps = {
      provider,
      config,
      source,
      root,
      diffs,
      label: resolution.label,
      rules,
      instruction: request.instruction,
      meter,
    };

    const plan = planReview(kept, review);
    warnings.push(...plan.warnings);
    const tasks = plan.batches.flatMap((batch) => batch.passes.map((pass) => ({ batch, pass })));
    const agent = new ReviewAgent(deps);
    let completed = 0;
    this.progress(`Reviewing ${kept.length} file(s) in ${tasks.length} pass(es)`);

    const failures: unknown[] = [];
    const results = await mapPool(tasks, review.concurrency, async ({ batch, pass }) => {
      try {
        return await agent.review(batch, pass, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        failures.push(error);
        return { findings: [] as ReviewFinding[], warnings: [`batch ${batch.id} (${pass}) failed: ${errorMessage(error)}`] };
      } finally {
        this.progress(`Reviewed ${++completed}/${tasks.length}`);
      }
    });
    if (failures.length === tasks.length) throw failures[0];
    warnings.push(...results.flatMap((r) => r.warnings));

    const candidates = dedupeFindings(results.flatMap((r) => r.findings));
    let findings = candidates;
    let verified = 0;
    let rejected = 0;

    if (review.verify && candidates.length > 0) {
      const eligible = candidates.filter((f) => f.confidence >= VERIFY_FLOOR);
      this.progress(`Verifying ${Math.min(eligible.length, review.maxVerifications)} finding(s)`);
      const outcome = await new Verifier(deps).verify(eligible, signal);
      findings = outcome.findings;
      verified = outcome.verified;
      rejected = outcome.rejected;
      warnings.push(...outcome.warnings);
    }

    const final = findings.filter((f) => f.confidence >= review.minConfidence).slice(0, review.maxFindings);
    return finish(final, { candidates: candidates.length, verified, rejected });
  }
}
