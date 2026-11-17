import type { Command } from "commander";
import { GitAnalyzer } from "../../analyzers/git-analyzer";
import { globalConfigPath, isProviderType, loadConfig, projectConfigPath, writeConfigTemplate } from "../../config/loader";
import { providerTypes } from "../../config/schema";
import { CrvError } from "../../errors";

async function repoRoot(cwd: string): Promise<string> {
  try {
    return (await GitAnalyzer.open(cwd)).root;
  } catch {
    return cwd;
  }
}

export function registerConfig(program: Command): void {
  const config = program.command("config").description("Manage configuration");

  config
    .command("init")
    .description("Create a configuration file")
    .option("--global", "write the user-level config instead of the project config")
    .option("--force", "overwrite an existing file")
    .option("--provider <type>", `provider type: ${providerTypes.join(" | ")}`, "openai-chat")
    .option("-C, --cwd <dir>", "repository directory", process.cwd())
    .action(async (options: { global?: boolean; force?: boolean; provider: string; cwd: string }) => {
      if (!isProviderType(options.provider)) throw new CrvError(`Unknown provider type: ${options.provider}`);
      const file = await writeConfigTemplate(await repoRoot(options.cwd), { global: options.global, force: options.force, type: options.provider });
      process.stdout.write(`Created ${file}\nSet your API key in the environment (for example OPENAI_API_KEY) and run \`crv review\`.\n`);
    });

  config
    .command("show")
    .description("Print the effective configuration")
    .option("-C, --cwd <dir>", "repository directory", process.cwd())
    .action(async (options: { cwd: string }) => {
      const loaded = await loadConfig(await repoRoot(options.cwd));
      const redacted = { ...loaded, provider: { ...loaded.provider, apiKey: loaded.provider.apiKey ? "***" : undefined } };
      process.stdout.write(`${JSON.stringify(redacted, null, 2)}\n`);
    });

  config
    .command("path")
    .description("Print configuration file locations")
    .option("-C, --cwd <dir>", "repository directory", process.cwd())
    .action(async (options: { cwd: string }) => {
      process.stdout.write(`project: ${projectConfigPath(await repoRoot(options.cwd))}\nglobal:  ${globalConfigPath()}\n`);
    });
}
