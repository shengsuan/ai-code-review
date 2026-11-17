import { createHash } from "node:crypto";
import { z } from "zod";
import { similarity } from "../../util/text";
import type { CodeSource } from "../context/source";
import { normalizeRelative } from "../../util/path";
import { splitLines } from "../../util/text";

export const severities = ["critical", "high", "medium", "low"] as const;
export const categories = ["bug", "security", "performance", "logic", "maintainability"] as const;

export type Severity = (typeof severities)[number];
export type Category = (typeof categories)[number];

export interface FindingLocation {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface ReviewFinding {
  id: string;
  title: string;
  severity: Severity;
  confidence: number;
  filePath: string;
  startLine: number;
  endLine: number;
  category: Category;
  description: string;
  evidence: string;
  suggestion: string;
  related?: FindingLocation[];
  verification?: { verdict: "confirmed" | "uncertain"; reason: string };
}

const lower = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : value);

const confidence = z.preprocess((value) => {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof n === "number" && n > 1 && n <= 100 ? n / 100 : n;
}, z.number().min(0).max(1));

export const rawFindingSchema = z.object({
  title: z.string().trim().min(1),
  severity: z.preprocess(lower, z.enum(severities)),
  confidence,
  category: z.preprocess(lower, z.enum(categories)).default("bug"),
  filePath: z.string().trim().min(1),
  startLine: z.coerce.number().int().min(1),
  endLine: z.coerce.number().int().min(1).optional(),
  description: z.string().default(""),
  evidence: z.string().default(""),
  suggestion: z.string().default(""),
});

export const severityRank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function makeFindingId(finding: Pick<ReviewFinding, "filePath" | "category" | "title">): string {
  const key = `${finding.filePath}\0${finding.category}\0${finding.title.toLowerCase().replace(/\s+/g, " ")}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 10);
}

export interface ParseResult {
  findings: ReviewFinding[];
  invalid: number;
}

export function parseFindings(raw: unknown[]): ParseResult {
  const findings: ReviewFinding[] = [];
  let invalid = 0;
  for (const item of raw) {
    const parsed = rawFindingSchema.safeParse(item);
    if (!parsed.success) {
      invalid++;
      continue;
    }
    const data = parsed.data;
    const finding: ReviewFinding = {
      id: "",
      title: data.title,
      severity: data.severity,
      confidence: data.confidence,
      filePath: data.filePath,
      startLine: data.startLine,
      endLine: Math.max(data.endLine ?? data.startLine, data.startLine),
      category: data.category,
      description: data.description,
      evidence: data.evidence,
      suggestion: data.suggestion,
    };
    finding.id = makeFindingId(finding);
    findings.push(finding);
  }
  return { findings, invalid };
}

export interface AnchorOptions {
  source: CodeSource;
  root: string;
  knownPaths: ReadonlySet<string>;
}

export async function anchorFindings(
  findings: ReviewFinding[],
  options: AnchorOptions,
): Promise<{ kept: ReviewFinding[]; dropped: number }> {
  const lineCounts = new Map<string, number | null>();
  const lineCount = async (filePath: string): Promise<number | null> => {
    if (!lineCounts.has(filePath)) {
      const content = await options.source.read(filePath);
      lineCounts.set(filePath, content === null ? null : splitLines(content).length);
    }
    return lineCounts.get(filePath) ?? null;
  };

  const kept: ReviewFinding[] = [];
  let dropped = 0;
  for (const finding of findings) {
    let filePath = finding.filePath.replace(/\\/g, "/");
    if (filePath.startsWith(options.root)) filePath = filePath.slice(options.root.length).replace(/^\/+/, "");
    if (!options.knownPaths.has(filePath)) {
      const stripped = filePath.replace(/^[ab]\//, "");
      if (options.knownPaths.has(stripped)) filePath = stripped;
    }
    const normalized = normalizeRelative(filePath);
    const count = normalized ? await lineCount(normalized) : null;
    if (!normalized || count === null || finding.startLine > count) {
      dropped++;
      continue;
    }
    const next = { ...finding, filePath: normalized, endLine: Math.min(finding.endLine, count) };
    next.id = makeFindingId(next);
    kept.push(next);
  }
  return { kept, dropped };
}

function overlaps(a: FindingLocation, b: FindingLocation): boolean {
  return a.startLine <= b.endLine + 2 && b.startLine <= a.endLine + 2;
}

interface Group {
  finding: ReviewFinding;
  titles: string[];
}

function sameRootCause(group: Group, candidate: Group): boolean {
  const a = group.finding;
  const b = candidate.finding;
  const score = Math.max(...group.titles.flatMap((x) => candidate.titles.map((y) => similarity(x, y))));
  if (a.filePath === b.filePath) return (overlaps(a, b) && (a.category === b.category || score >= 0.5)) || score >= 0.8;
  return a.category === b.category && score >= 0.9;
}

function absorb(target: Group, source: Group): void {
  const a = target.finding;
  const b = source.finding;
  target.titles.push(...source.titles);
  if (a.filePath === b.filePath && overlaps(a, b)) {
    a.startLine = Math.min(a.startLine, b.startLine);
    a.endLine = Math.max(a.endLine, b.endLine);
  } else {
    a.related = [...(a.related ?? []), { filePath: b.filePath, startLine: b.startLine, endLine: b.endLine }];
  }
  a.related = [...(a.related ?? []), ...(b.related ?? [])];
  a.confidence = Math.max(a.confidence, b.confidence);
  a.suggestion ||= b.suggestion;
  a.evidence ||= b.evidence;
}

export function dedupeFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const sorted = [...findings].sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity] || b.confidence - a.confidence,
  );
  const groups: Group[] = sorted.map((f) => ({ finding: { ...f, related: [...(f.related ?? [])] }, titles: [f.title] }));

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const left = groups[i] as Group;
        const right = groups[j] as Group;
        if (!sameRootCause(left, right)) continue;
        absorb(left, right);
        groups.splice(j, 1);
        merged = true;
        break;
      }
    }
  }

  const seen = new Set<string>();
  return groups.map(({ finding }) => {
    const base = makeFindingId(finding);
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
    seen.add(id);
    return { ...finding, id, related: finding.related?.length ? finding.related : undefined };
  });
}

export function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort(
    (a, b) =>
      severityRank[b.severity] - severityRank[a.severity] ||
      b.confidence - a.confidence ||
      a.filePath.localeCompare(b.filePath) ||
      a.startLine - b.startLine,
  );
}
