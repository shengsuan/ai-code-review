import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/server";
import { ReviewOrchestrator } from "../src/core/review/orchestrator";
import { createRuntime } from "../src/core/runtime";
import { renderReport } from "../src/output";

interface ChatBody {
  messages: Array<{ role: string; content: string }>;
}

let server: http.Server;
let repo: string;
let baseUrl: string;
const seenSystems: string[] = [];
const seenUsers: string[] = [];

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function reply(body: ChatBody): string {
  const system = body.messages[0]?.content ?? "";
  const turns = body.messages.filter((m) => m.role === "user").length;
  seenSystems.push(system.slice(0, 40));
  seenUsers.push(body.messages.find((m) => m.role === "user")?.content ?? "");
  if (system.includes("skeptical senior reviewer")) {
    if (turns === 1) return JSON.stringify({ tool_calls: [{ name: "read_file", arguments: { path: "src/db.ts", startLine: 1, endLine: 20 } }] });
    return JSON.stringify({ verdict: "confirmed", confidence: 0.92, reason: "query is built by concatenation" });
  }
  if (system.includes("application security engineer")) {
    return JSON.stringify({
      findings: [
        {
          title: "SQL injection in findUser",
          severity: "critical",
          confidence: 0.95,
          category: "security",
          filePath: "src/db.ts",
          startLine: 2,
          endLine: 3,
          description: "id is concatenated into SQL",
          evidence: "SELECT * FROM users WHERE id = ",
          suggestion: "use parameters",
        },
      ],
    });
  }
  if (system.includes("principal engineer")) {
    return JSON.stringify({
      findings: [
        { title: "SQL injection in findUser()", severity: "high", confidence: 0.8, category: "bug", filePath: "src/db.ts", startLine: 3, description: "dup", evidence: "x", suggestion: "y" },
        { title: "Phantom", severity: "low", confidence: 0.9, category: "bug", filePath: "src/missing.ts", startLine: 1, description: "", evidence: "", suggestion: "" },
      ],
    });
  }
  return "Explanation: concatenation allows injection.";
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const content = reply(JSON.parse(raw) as ChatBody);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  repo = mkdtempSync(path.join(os.tmpdir(), "crv-e2e-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.dev");
  git("config", "user.name", "t");
  mkdirSync(path.join(repo, "src"));
  writeFileSync(path.join(repo, "src", "util.ts"), "export const add = (a: number, b: number) => a + b;\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", "feature");
  writeFileSync(
    path.join(repo, "src", "db.ts"),
    ["export function findUser(db: any, id: string) {", '  const sql = "SELECT * FROM users WHERE id = " + id;', "  return db.query(sql);", "}", ""].join("\n"),
  );
  git("add", ".");
  git("commit", "-q", "-m", "add db");
  writeFileSync(path.join(repo, "src", "wip.ts"), "export const wip = 1;\n");
  process.env.CRV_API_KEY = "test-key";
});

afterAll(() => {
  server.close();
  rmSync(repo, { recursive: true, force: true });
});

const overrides = () => ({ provider: { type: "compatible", baseUrl, model: "fake", maxRetries: 0 } });

describe("end to end", () => {
  it("reviews a commit, verifies, dedupes and stores the report", async () => {
    const runtime = await createRuntime(repo, overrides());
    const report = await new ReviewOrchestrator(runtime).run({ target: { kind: "commit", commit: "HEAD" } });

    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0]!;
    expect(finding).toMatchObject({ severity: "critical", category: "security", filePath: "src/db.ts", confidence: 0.92 });
    expect(finding.verification?.verdict).toBe("confirmed");
    expect(report.stats.llmCalls).toBeGreaterThanOrEqual(4);
    expect(report.stats.verified).toBe(1);

    const stored = await runtime.store.get(report.id);
    expect(stored.id).toBe(report.id);
    expect((await runtime.store.get("latest")).id).toBe(report.id);
    expect(JSON.parse(renderReport(report, "sarif", { color: false })).runs[0].results).toHaveLength(1);
    expect(renderReport(report, "terminal", { color: false })).toContain("SQL injection");
  });

  it("reviews the working tree including untracked files", async () => {
    const runtime = await createRuntime(repo, overrides());
    const report = await new ReviewOrchestrator(runtime).run({ target: { kind: "workspace" }, instruction: "focus on SQL" });
    expect(report.target.mode).toBe("workspace");
    expect(report.summary.filesReviewed).toBe(1);
  });

  it("reviews a branch range and reports empty diffs", async () => {
    const runtime = await createRuntime(repo, overrides());
    const range = await new ReviewOrchestrator(runtime).run({ target: { kind: "range", base: "main" } });
    expect(range.summary.filesReviewed).toBe(1);
    const empty = await new ReviewOrchestrator(runtime).run({ target: { kind: "staged" } });
    expect(empty.findings).toHaveLength(0);
    expect(empty.warnings).toContain("No reviewable changes found");
  });

  it("scopes files with include rules and passes path rules to the model", async () => {
    const runtime = await createRuntime(repo, overrides());
    const rulesPath = path.join(repo, "scoped-rules.json");
    writeFileSync(rulesPath, JSON.stringify({ include: ["src/db.ts"], rules: [{ path: "src/**/*.ts", rule: "SCOPED-RULE-MARKER" }] }));
    const report = await new ReviewOrchestrator(runtime).run({ target: { kind: "range", base: "main" }, rules: ["scoped-rules.json"] });
    expect(report.summary.filesReviewed).toBe(1);
    expect(seenUsers.some((u) => u.includes("SCOPED-RULE-MARKER") && u.includes("Files: src/db.ts"))).toBe(true);

    writeFileSync(rulesPath, JSON.stringify({ exclude: ["src/**"] }));
    const none = await new ReviewOrchestrator(runtime).run({ target: { kind: "range", base: "main" }, rules: ["scoped-rules.json"] });
    expect(none.warnings).toContain("No reviewable changes found");
    expect(none.skipped).toEqual([{ path: "src/db.ts", reason: "excluded by rules" }]);
    rmSync(rulesPath);
  });

  it("rejects option-like refs and path escapes", async () => {
    const runtime = await createRuntime(repo, overrides());
    const orchestrator = new ReviewOrchestrator(runtime);
    await expect(orchestrator.run({ target: { kind: "commit", commit: "--output=/tmp/x" } })).rejects.toThrow(/Invalid git revision/);
    await expect(orchestrator.run({ target: { kind: "file", filePath: "../../etc/passwd" } })).rejects.toThrow(/escapes workspace/);
  });

  it("surfaces provider failures instead of an empty report", async () => {
    const runtime = await createRuntime(repo, { provider: { type: "compatible", baseUrl: "http://127.0.0.1:1/v1", model: "fake", maxRetries: 0 } });
    await expect(new ReviewOrchestrator(runtime).run({ target: { kind: "commit", commit: "HEAD" } })).rejects.toThrow(/Network error/);
  });

  it("exposes MCP tools over a transport", async () => {
    process.chdir(repo);
    const mcp = createMcpServer({ workspace: repo });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["explain_finding", "get_review_report", "review_file", "review_staged", "review_workspace"]);

    const config = path.join(repo, ".crv");
    mkdirSync(config, { recursive: true });
    writeFileSync(path.join(config, "config.json"), JSON.stringify(overrides()));

    const result = (await client.callTool({ name: "review_file", arguments: { filePath: "src/db.ts" } })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeFalsy();
    const report = JSON.parse(result.content[0]!.text) as { id: string; findings: Array<{ id: string }> };
    expect(report.findings).toHaveLength(1);

    const fetched = (await client.callTool({ name: "get_review_report", arguments: { reviewId: report.id } })) as { content: Array<{ text: string }> };
    expect(JSON.parse(fetched.content[0]!.text).id).toBe(report.id);

    const explained = (await client.callTool({ name: "explain_finding", arguments: { findingId: report.findings[0]!.id } })) as { content: Array<{ text: string }> };
    expect(explained.content[0]!.text).toContain("injection");

    const escape = (await client.callTool({ name: "review_file", arguments: { filePath: "../secret" } })) as { isError?: boolean };
    expect(escape.isError).toBe(true);
    await client.close();
  });
});
