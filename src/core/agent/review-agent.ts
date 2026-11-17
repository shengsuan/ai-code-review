import { z } from "zod";
import type { FileDiff } from "../../analyzers/diff-analyzer";
import type { Config } from "../../config/schema";
import type { LLMProvider } from "../../providers";
import { type Toolbox, createToolbox } from "../../tools";
import { ContextCollector, renderContext } from "../context/collector";
import type { CodeSource } from "../context/source";
import { type ReviewFinding, anchorFindings, parseFindings } from "../review/finding";
import { type ReviewRules, renderRules } from "../review/rules";
import { prompts, withProtocol } from "../../prompts";
import { type UsageMeter, runAgentLoop } from "./loop";
import type { ReviewBatch, ReviewPass } from "./review-planner";

export interface AgentDeps {
  provider: LLMProvider;
  config: Config;
  source: CodeSource;
  root: string;
  diffs: ReadonlyMap<string, FileDiff>;
  label: string;
  rules: ReviewRules;
  instruction?: string;
  meter: UsageMeter;
}

export interface BatchResult {
  findings: ReviewFinding[];
  warnings: string[];
}

const findingsEnvelope = z.object({ findings: z.array(z.unknown()) });

export function createAgentToolbox(deps: Pick<AgentDeps, "source" | "root" | "diffs" | "config">, signal?: AbortSignal): Toolbox {
  return createToolbox({ source: deps.source, root: deps.root, diffs: deps.diffs, config: deps.config, signal });
}

export class ReviewAgent {
  private readonly collector: ContextCollector;

  constructor(private readonly deps: AgentDeps) {
    this.collector = new ContextCollector(deps.source);
  }

  async review(batch: ReviewBatch, pass: ReviewPass, signal?: AbortSignal): Promise<BatchResult> {
    const { config, provider, meter } = this.deps;
    const toolbox = createAgentToolbox(this.deps, signal);
    const sections = await this.collector.collect(batch.files);
    const context = renderContext(sections, config.review.contextCharBudget);
    const template = pass === "security" ? prompts.security : prompts.review;
    const system = withProtocol(template, toolbox.describe(), {
      language: config.review.language,
      maxFindings: config.review.maxFindings,
    });

    const value = await runAgentLoop({
      provider,
      system,
      user: this.userPrompt(batch, context),
      toolbox,
      maxToolSteps: config.review.maxToolSteps,
      meter,
      signal,
    });

    const label = `batch ${batch.id} (${pass})`;
    const envelope = findingsEnvelope.safeParse(Array.isArray(value) ? { findings: value } : value);
    if (!envelope.success) return { findings: [], warnings: [`${label}: model did not return a usable result`] };

    const { findings, invalid } = parseFindings(envelope.data.findings);
    const knownPaths = new Set(this.deps.diffs.keys());
    const { kept, dropped } = await anchorFindings(findings, { source: this.deps.source, root: this.deps.root, knownPaths });
    const warnings: string[] = [];
    if (invalid + dropped > 0) warnings.push(`${label}: discarded ${invalid + dropped} malformed or unlocatable finding(s)`);
    return { findings: kept, warnings };
  }

  private userPrompt(batch: ReviewBatch, context: string): string {
    const parts = [`Review target: ${this.deps.label}`];
    if (this.deps.instruction) {
      parts.push(`## Custom instruction from the user\n${this.deps.instruction}\nGive this instruction priority, while still reporting any serious defect you notice.`);
    }
    const rules = renderRules(this.deps.rules, batch.files.map((f) => f.path));
    if (rules) parts.push(`## Project review rules\n${rules}`);
    parts.push(
      `## Diff\nThe left column is the line number in the new file. "+" marks added lines, "-" removed lines, a blank marker unchanged context.\n\n${batch.diffText}`,
    );
    if (context) parts.push(`## Context\n${context}`);
    parts.push("Review the diff now.");
    return parts.join("\n\n");
  }
}
