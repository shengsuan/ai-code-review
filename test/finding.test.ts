import { describe, expect, it } from "vitest";
import { dedupeFindings, parseFindings } from "../src/core/review/finding";

const base = {
  severity: "high",
  confidence: 0.8,
  category: "bug",
  description: "d",
  evidence: "e",
  suggestion: "s",
};

describe("findings", () => {
  it("parses lenient model output and drops invalid items", () => {
    const { findings, invalid } = parseFindings([
      { ...base, title: "A", filePath: "a.ts", startLine: "10", severity: "HIGH", confidence: 85 },
      { title: "", filePath: "a.ts", startLine: 1 },
      { ...base, title: "B", filePath: "b.ts", startLine: 3, endLine: 1 },
    ]);
    expect(invalid).toBe(1);
    expect(findings[0]).toMatchObject({ startLine: 10, severity: "high", confidence: 0.85, endLine: 10 });
    expect(findings[1]!.endLine).toBe(3);
  });

  it("merges findings sharing a root cause", () => {
    const raw = parseFindings([
      { ...base, title: "Missing null check on user", filePath: "a.ts", startLine: 10, endLine: 12, severity: "medium", confidence: 0.7 },
      { ...base, title: "User may be null", filePath: "a.ts", startLine: 11, endLine: 14, severity: "high", confidence: 0.9 },
      { ...base, title: "Missing null check on user", filePath: "b.ts", startLine: 5, severity: "medium" },
      { ...base, title: "Hardcoded secret", filePath: "c.ts", startLine: 1, category: "security" },
    ]).findings;
    const merged = dedupeFindings(raw);
    expect(merged).toHaveLength(2);
    const first = merged.find((f) => f.filePath === "a.ts")!;
    expect(first).toMatchObject({ severity: "high", confidence: 0.9, startLine: 10, endLine: 14 });
    expect(first.related).toEqual([{ filePath: "b.ts", startLine: 5, endLine: 5 }]);
    expect(new Set(merged.map((f) => f.id)).size).toBe(2);
  });
});
