import { describe, expect, it } from "vitest";
import { extractJson } from "../src/util/json";
import { normalizeRelative, resolveWithin } from "../src/util/path";
import { similarity } from "../src/util/text";

describe("extractJson", () => {
  it("parses plain, fenced and embedded JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! {"a":"}{","b":[1]} done')).toEqual({ a: "}{", b: [1] });
  });

  it("returns undefined for non JSON", () => {
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson("42")).toBeUndefined();
  });
});

describe("paths", () => {
  it("rejects escapes", () => {
    expect(() => resolveWithin("/repo", "../etc/passwd")).toThrow();
    expect(resolveWithin("/repo", "src/a.ts")).toBe("/repo/src/a.ts");
    expect(normalizeRelative("../x")).toBeNull();
    expect(normalizeRelative("/abs")).toBeNull();
    expect(normalizeRelative("./src\\a.ts")).toBe("src/a.ts");
  });
});

describe("similarity", () => {
  it("scores near duplicates high and unrelated low", () => {
    expect(similarity("Null dereference in parseUser", "null dereference in parseUser()")).toBeGreaterThan(0.8);
    expect(similarity("SQL injection", "Missing await")).toBeLessThan(0.3);
    expect(similarity("空指针解引用", "空指针解引用问题")).toBeGreaterThan(0.6);
  });
});
