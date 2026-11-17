import { describe, expect, it } from "vitest";
import { changedRanges, filterDiffs, parseDiff, renderFileDiff, synthesizeNewFileDiff } from "../src/analyzers/diff-analyzer";

const SAMPLE = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,4 +1,5 @@",
  " one",
  "-two",
  "+two changed",
  "+two and a half",
  " three",
  " four",
  "diff --git a/old.txt b/new.txt",
  "similarity index 90%",
  "rename from old.txt",
  "rename to new.txt",
  "diff --git a/img.png b/img.png",
  "Binary files a/img.png and b/img.png differ",
  "diff --git a/package-lock.json b/package-lock.json",
  "--- a/package-lock.json",
  "+++ b/package-lock.json",
  "@@ -1 +1 @@",
  "--- not a header",
  "+++ also not a header",
  "",
].join("\n");

describe("diff analyzer", () => {
  const files = parseDiff(SAMPLE);

  it("parses files, hunks and line numbers", () => {
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "new.txt", "img.png", "package-lock.json"]);
    const a = files[0]!;
    expect(a.additions).toBe(2);
    expect(a.deletions).toBe(1);
    expect(a.hunks[0]!.lines.filter((l) => l.type === "add").map((l) => l.newLine)).toEqual([2, 3]);
    expect(files[1]!.status).toBe("renamed");
    expect(files[2]!.binary).toBe(true);
  });

  it("does not mistake content lines for headers", () => {
    const lock = files[3]!;
    expect(lock.deletions).toBe(1);
    expect(lock.additions).toBe(1);
  });

  it("computes changed ranges on the new side", () => {
    expect(changedRanges(files[0]!)).toEqual([{ start: 2, end: 3 }]);
  });

  it("renders new-file line numbers", () => {
    expect(renderFileDiff(files[0]!)).toContain("     2 + two changed");
  });

  it("filters ignored, binary and empty diffs", () => {
    const { kept, skipped } = filterDiffs(files, ["**/package-lock.json"]);
    expect(kept.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(skipped.map((s) => s.reason).sort()).toEqual(["binary file", "ignored by configuration", "no textual changes"]);
  });

  it("synthesizes a parsable new file diff", () => {
    const [file] = parseDiff(synthesizeNewFileDiff("x/y.ts", "a\nb\n"));
    expect(file!.status).toBe("added");
    expect(file!.additions).toBe(2);
  });
});
