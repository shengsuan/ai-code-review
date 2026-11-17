import { execFile } from "node:child_process";
import { z } from "zod";
import { defineTool } from "./tool";

const TAIL_CHARS = 6000;

export const runChecksTool = defineTool({
  name: "run_checks",
  signature: 'run_checks({"name": string})',
  description: "Run a project check (type check, lint, tests) that is predefined in the configuration and report its output.",
  schema: z.object({ name: z.string().min(1) }),
  enabled: (context) => context.source.kind === "worktree" && context.config.checks.length > 0,
  run(args, context) {
    const check = context.config.checks.find((c) => c.name === args.name);
    if (!check) {
      return Promise.resolve(`Unknown check "${args.name}". Available: ${context.config.checks.map((c) => c.name).join(", ")}`);
    }
    return new Promise((resolve) => {
      execFile(
        check.command,
        check.args,
        {
          cwd: context.root,
          timeout: check.timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          shell: process.platform === "win32",
          signal: context.signal,
        },
        (error, stdout, stderr) => {
          const exit = error ? ((error as NodeJS.ErrnoException & { code?: number | string }).code ?? "failed") : 0;
          const output = `${stdout}\n${stderr}`.trim();
          const tail = output.length > TAIL_CHARS ? `...${output.slice(-TAIL_CHARS)}` : output;
          resolve(`exit: ${exit}\n${tail}`);
        },
      );
    });
  },
});
