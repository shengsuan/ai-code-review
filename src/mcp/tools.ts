import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ReviewTarget } from "../analyzers/git-analyzer";
import { explainFinding } from "../core/review/explain";
import { ReviewOrchestrator, type ReviewRequest } from "../core/review/orchestrator";
import { createRuntime } from "../core/runtime";
import { errorMessage } from "../errors";
import { logger } from "../util/logger";

const rules = z.array(z.string()).optional().describe("Extra review rules: rule file paths inside the workspace, or inline rule text");
const instruction = z.string().optional().describe("Custom instruction that steers the review");

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

function text(value: string): CallToolResult {
  return { content: [{ type: "text", text: value }] };
}

async function guarded(action: () => Promise<string>): Promise<CallToolResult> {
  try {
    return text(await action());
  } catch (error) {
    logger.error({ error: errorMessage(error) }, "tool failed");
    return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
  }
}

async function review(workspace: string, request: ReviewRequest, signal: AbortSignal): Promise<string> {
  const runtime = await createRuntime(workspace);
  const report = await new ReviewOrchestrator(runtime, {
    signal,
    onProgress: (message) => logger.info(message),
  }).run(request);
  return JSON.stringify(report);
}

export function registerTools(server: McpServer, workspace: string): void {
  server.registerTool(
    "review_workspace",
    {
      title: "Review workspace",
      description:
        "Review code changes. Without arguments reviews staged, unstaged and untracked changes. With base (and optional head) reviews the branch difference; with commit reviews that commit. Returns a ReviewReport as JSON.",
      inputSchema: {
        base: z.string().optional().describe("Base ref to compare against, for example origin/main"),
        head: z.string().optional().describe("Head ref, defaults to HEAD (requires base)"),
        commit: z.string().optional().describe("Review the changes introduced by this commit"),
        rules,
        instruction,
      },
      annotations,
    },
    (args, extra) =>
      guarded(async () => {
        let target: ReviewTarget = { kind: "workspace" };
        if (args.base) target = { kind: "range", base: args.base, head: args.head };
        else if (args.commit) target = { kind: "commit", commit: args.commit };
        return review(workspace, { target, rules: args.rules, instruction: args.instruction }, extra.signal);
      }),
  );

  server.registerTool(
    "review_staged",
    {
      title: "Review staged changes",
      description: "Review the changes in the Git staging area. Returns a ReviewReport as JSON.",
      inputSchema: { rules, instruction },
      annotations,
    },
    (args, extra) =>
      guarded(() => review(workspace, { target: { kind: "staged" }, rules: args.rules, instruction: args.instruction }, extra.signal)),
  );

  server.registerTool(
    "review_file",
    {
      title: "Review file",
      description: "Review a whole file inside the workspace. Returns a ReviewReport as JSON.",
      inputSchema: { filePath: z.string().min(1).describe("File path relative to the workspace root"), rules, instruction },
      annotations,
    },
    (args, extra) =>
      guarded(() =>
        review(workspace, { target: { kind: "file", filePath: args.filePath }, rules: args.rules, instruction: args.instruction }, extra.signal),
      ),
  );

  server.registerTool(
    "get_review_report",
    {
      title: "Get review report",
      description: 'Fetch a saved ReviewReport by id. Use "latest" for the most recent review.',
      inputSchema: { reviewId: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(async () => {
        const runtime = await createRuntime(workspace);
        return JSON.stringify(await runtime.store.get(args.reviewId));
      }),
  );

  server.registerTool(
    "explain_finding",
    {
      title: "Explain finding",
      description: "Explain a review finding in depth: root cause, trigger, impact and fix.",
      inputSchema: {
        findingId: z.string().min(1),
        reviewId: z.string().optional().describe("Review containing the finding; defaults to searching recent reviews"),
      },
      annotations,
    },
    (args, extra) =>
      guarded(async () => {
        const runtime = await createRuntime(workspace);
        const found = await runtime.store.findFinding(args.findingId, args.reviewId);
        if (!found) throw new Error(`Finding not found: ${args.findingId}`);
        return explainFinding(runtime, found.report, found.finding, extra.signal);
      }),
  );
}
