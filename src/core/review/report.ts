import { randomBytes } from "node:crypto";
import type { SkippedFile } from "../../analyzers/diff-analyzer";
import type { ReviewTarget } from "../../analyzers/git-analyzer";
import { type Category, type ReviewFinding, type Severity, categories, severities, sortFindings } from "./finding";

export interface ReportTarget {
  mode: ReviewTarget["kind"];
  label: string;
  ref?: string;
  instruction?: string;
}

export interface ReportStats {
  durationMs: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  candidates: number;
  verified: number;
  rejected: number;
}

export interface ReportSummary {
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<Category, number>;
  filesReviewed: number;
  filesSkipped: number;
}

export interface ReviewReport {
  id: string;
  createdAt: string;
  target: ReportTarget;
  model: { provider: string; name: string };
  summary: ReportSummary;
  findings: ReviewFinding[];
  skipped: SkippedFile[];
  warnings: string[];
  stats: ReportStats;
}

export interface ReportInput {
  target: ReportTarget;
  model: { provider: string; name: string };
  findings: ReviewFinding[];
  skipped: SkippedFile[];
  warnings: string[];
  filesReviewed: number;
  stats: ReportStats;
}

export function newReviewId(): string {
  return `rv_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

function countBy<K extends string>(keys: readonly K[], values: K[]): Record<K, number> {
  const counts = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const value of values) counts[value]++;
  return counts;
}

export function buildReport(input: ReportInput): ReviewReport {
  const findings = sortFindings(input.findings);
  return {
    id: newReviewId(),
    createdAt: new Date().toISOString(),
    target: input.target,
    model: input.model,
    summary: {
      totalFindings: findings.length,
      bySeverity: countBy(severities, findings.map((f) => f.severity)),
      byCategory: countBy(categories, findings.map((f) => f.category)),
      filesReviewed: input.filesReviewed,
      filesSkipped: input.skipped.length,
    },
    findings,
    skipped: input.skipped,
    warnings: input.warnings,
    stats: input.stats,
  };
}
