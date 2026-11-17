import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZodError } from "zod";
import { ConfigError } from "../errors";
import { type Config, type ProviderType, configSchema, providerTypes } from "./schema";

export type Overrides = Record<string, unknown>;

export function globalConfigPath(): string {
  const base =
    process.platform === "win32"
      ? (process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"))
      : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
  return path.join(base, "crv", "config.json");
}

export function projectConfigPath(root: string): string {
  return path.join(root, ".crv", "config.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return result;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ConfigError(`Cannot read ${file}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`Invalid JSON in ${file}`);
  }
  if (!isRecord(parsed)) throw new ConfigError(`Config must be a JSON object: ${file}`);
  return parsed;
}

function envOverrides(env: NodeJS.ProcessEnv): Overrides {
  return {
    provider: {
      type: env.CRV_PROVIDER,
      model: env.CRV_MODEL,
      baseUrl: env.CRV_BASE_URL,
    },
  };
}

export async function loadConfig(root: string, overrides: Overrides = {}): Promise<Config> {
  const layers = [await readJson(globalConfigPath()), await readJson(projectConfigPath(root)), envOverrides(process.env), overrides];
  const merged = layers.reduce((acc, layer) => deepMerge(acc, layer), {} as Record<string, unknown>);
  try {
    return configSchema.parse(merged);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ");
      throw new ConfigError(`Invalid configuration: ${details}`);
    }
    throw error;
  }
}

const TEMPLATE_DEFAULTS: Record<ProviderType, { model: string; apiKeyEnv: string; baseUrl?: string }> = {
  "openai-chat": { model: "gpt-4o", apiKeyEnv: "OPENAI_API_KEY" },
  "openai-responses": { model: "gpt-4o", apiKeyEnv: "OPENAI_API_KEY" },
  anthropic: { model: "claude-sonnet-5-5", apiKeyEnv: "ANTHROPIC_API_KEY" },
  compatible: { model: "your-model", apiKeyEnv: "CRV_API_KEY", baseUrl: "http://localhost:11434/v1" },
};

export function isProviderType(value: string): value is ProviderType {
  return (providerTypes as readonly string[]).includes(value);
}

export async function writeConfigTemplate(
  root: string,
  options: { global?: boolean; force?: boolean; type?: ProviderType },
): Promise<string> {
  const file = options.global ? globalConfigPath() : projectConfigPath(root);
  const type = options.type ?? "openai-chat";
  const defaults = TEMPLATE_DEFAULTS[type];
  const template = {
    provider: { type, model: defaults.model, ...(defaults.baseUrl ? { baseUrl: defaults.baseUrl } : {}), apiKeyEnv: defaults.apiKeyEnv },
    review: { minConfidence: 0.6, verify: true, security: "auto", language: "zh-CN" },
    checks: [],
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, `${JSON.stringify(template, null, 2)}\n`, { flag: options.force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ConfigError(`Config already exists: ${file} (use --force to overwrite)`);
    throw error;
  }
  if (!options.global) await fs.writeFile(path.join(root, ".crv", ".gitignore"), "reviews/\n", { flag: "a" });
  return file;
}
