import path from "node:path";
import type { Command } from "commander";
import { startMcpServer } from "../../mcp/server";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Start the MCP stdio server")
    .option("-w, --workspace <dir>", "workspace directory", process.cwd())
    .action(async (options: { workspace: string }) => {
      await startMcpServer({ workspace: path.resolve(options.workspace) });
    });
}
