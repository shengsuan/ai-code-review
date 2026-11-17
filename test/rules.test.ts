import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FileDiff } from "../src/analyzers/diff-analyzer";
import { loadRules, renderRules, scopeDiffs } from "../src/core/review/rules";

const RULES = {
  include: ["src/**/*.{ts,tsx}", "src/**/*.go"],
  exclude: ["**/*.test.ts", "**/generated/**"],
  rules: [
    { path: "src/api/**/*.go", rule: "All exported handlers must validate request bodies before use." },
    { path: "**/*mapper*.xml", rule: "Check SQL for injection risks, parameter errors, and missing closing tags." },
  ],
};

const diff = (p: string): FileDiff => ({ path: p, status: "modified", binary: false, hunks: [], additions: 1, deletions: 0 });

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "crv-rules-"));
  mkdirSync(path.join(root, ".crv"));
  writeFileSync(path.join(root, ".crv", "rules.json"), JSON.stringify(RULES));
  writeFileSync(path.join(root, ".crv", "rules.md"), "Prefer early returns.");
  writeFileSync(path.join(root, "bad.json"), JSON.stringify({ exlude: ["x"] }));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("structured rules", () => {
  it("loads rules.json and rules.md together", async () => {
    const rules = await loadRules(root, [".crv/rules.md", ".crv/rules.json"]);
    expect(rules.text).toBe("Prefer early returns.");
    expect(rules.include).toHaveLength(2);
    expect(rules.scoped).toHaveLength(2);
  });

  it("applies include and exclude globs", async () => {
    const rules = await loadRules(root, [".crv/rules.json"]);
    const { kept, skipped } = scopeDiffs(
      rules,
      ["src/a.ts", "src/ui/b.tsx", "src/api/user.go", "src/a.test.ts", "src/Generated/x.ts", "docs/readme.md", "src/api/UserMapper.xml"].map(diff),
    );
    expect(kept.map((f) => f.path)).toEqual(["src/a.ts", "src/ui/b.tsx", "src/api/user.go"]);
    expect(skipped.map((s) => [s.path, s.reason])).toEqual([
      ["src/a.test.ts", "excluded by rules"],
      ["src/Generated/x.ts", "excluded by rules"],
      ["docs/readme.md", "not matched by include rules"],
      ["src/api/UserMapper.xml", "not matched by include rules"],
    ]);
  });

  it("injects path-specific rules only for matching files", async () => {
    const rules = await loadRules(root, [".crv/rules.json"]);
    const goOnly = renderRules(rules, ["src/api/user.go", "src/a.ts"]);
    expect(goOnly).toContain("Files: src/api/user.go");
    expect(goOnly).toContain("validate request bodies");
    expect(goOnly).not.toContain("injection");
    const xml = renderRules(rules, ["db/OrderMapper.xml"]);
    expect(xml).toContain("injection");
    expect(renderRules(rules, ["src/a.ts"])).toBe("");
  });

  it("accepts rule files and inline text via requested rules", async () => {
    const rules = await loadRules(root, [], ["Never log tokens", ".crv/rules.json"]);
    expect(rules.text).toBe("Never log tokens");
    expect(rules.scoped).toHaveLength(2);
  });

  it("rejects unknown keys", async () => {
    await expect(loadRules(root, [], ["bad.json"])).rejects.toThrow(/Invalid rules file bad.json/);
  });
});
