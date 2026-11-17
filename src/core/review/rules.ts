import { promises as fs } from "node:fs";
import picomatch from "picomatch";
import type { FileDiff, SkippedFile } from "../../analyzers/diff-analyzer";
import { type RulesFile, rulesFileSchema } from "../../config/schema";
import { ConfigError } from "../../errors";
import { resolveWithin } from "../../util/path";
import { truncate } from "../../util/text";

const MAX_TEXT_CHARS = 8000;

export interface ScopedRule {
  patterns: string[];
  rule: string;
  matches(filePath: string): boolean;
}

export interface ReviewRules {
  text: string;
  include: string[];
  exclude: string[];
  scoped: ScopedRule[];
}

export function emptyRules(): ReviewRules {
  return { text: "", include: [], exclude: [], scoped: [] };
}

async function readRuleFile(root: string, candidate: string): Promise<string | null> {
  if (candidate.includes("\n") || candidate.length > 300) return null;
  try {
    const absolute = resolveWithin(root, candidate);
    const stat = await fs.stat(absolute);
    return stat.isFile() ? await fs.readFile(absolute, "utf8") : null;
  } catch {
    return null;
  }
}

function parseRulesFile(content: string, source: string): RulesFile {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new ConfigError(`Invalid JSON in rules file ${source}`);
  }
  const parsed = rulesFileSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid rules file ${source}: ${details}`);
  }
  return parsed.data;
}

function mergeStructured(target: ReviewRules, file: RulesFile): void {
  target.include = [...new Set([...target.include, ...file.include])];
  target.exclude = [...new Set([...target.exclude, ...file.exclude])];
  for (const entry of file.rules) {
    const patterns = Array.isArray(entry.path) ? entry.path : [entry.path];
    target.scoped.push({ patterns, rule: entry.rule, matches: picomatch(patterns, { dot: true, nocase: true }) });
  }
}

export async function loadRules(root: string, configured: string[], requested: string[] = []): Promise<ReviewRules> {
  const rules = emptyRules();
  const texts: string[] = [];
  const items = [
    ...configured.map((value) => ({ value, explicit: false })),
    ...requested.map((value) => ({ value, explicit: true })),
  ];
  for (const { value, explicit } of items) {
    const content = await readRuleFile(root, value);
    if (content === null) {
      if (explicit && value.trim()) texts.push(value.trim());
      continue;
    }
    if (value.toLowerCase().endsWith(".json")) mergeStructured(rules, parseRulesFile(content, value));
    else if (content.trim()) texts.push(content.trim());
  }
  rules.text = truncate(texts.join("\n\n"), MAX_TEXT_CHARS);
  return rules;
}

export function scopeDiffs(rules: ReviewRules, diffs: FileDiff[]): { kept: FileDiff[]; skipped: SkippedFile[] } {
  const included = rules.include.length > 0 ? picomatch(rules.include, { dot: true, nocase: true }) : null;
  const excluded = rules.exclude.length > 0 ? picomatch(rules.exclude, { dot: true, nocase: true }) : null;
  const kept: FileDiff[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of diffs) {
    if (included && !included(file.path)) skipped.push({ path: file.path, reason: "not matched by include rules" });
    else if (excluded?.(file.path)) skipped.push({ path: file.path, reason: "excluded by rules" });
    else kept.push(file);
  }
  return { kept, skipped };
}

export function renderRules(rules: ReviewRules, files: string[]): string {
  const parts: string[] = [];
  if (rules.text) parts.push(rules.text);
  const scoped = rules.scoped
    .map((entry) => ({ entry, matched: files.filter((f) => entry.matches(f)) }))
    .filter(({ matched }) => matched.length > 0)
    .map(({ entry, matched }) => `- Files: ${matched.join(", ")}\n  Rule: ${entry.rule}`);
  if (scoped.length > 0) parts.push(`### Path-specific rules (apply only to the listed files)\n${scoped.join("\n")}`);
  return parts.join("\n\n");
}
