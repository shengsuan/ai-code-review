import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "../version";
import { logger } from "../util/logger";
import { registerTools } from "./tools";

export interface McpServerOptions {
  workspace: string;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer({ name: "ai-code-review", version: VERSION });
  registerTools(server, options.workspace);
  return server;
}

function redirectConsole(): void {
  const toStderr = (...args: unknown[]) => {
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  redirectConsole();
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async (code: number) => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } finally {
      process.exit(code);
    }
  };

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.stdin.on("end", () => void shutdown(0));
  process.on("uncaughtException", (error) => {
    logger.error({ error: error.message }, "uncaught exception");
    void shutdown(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason: String(reason) }, "unhandled rejection");
  });

  await server.connect(transport);
  logger.info({ workspace: options.workspace }, "MCP server ready");
}
