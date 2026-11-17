import { z } from "zod";

export const providerTypes = ["openai-chat", "openai-responses", "anthropic", "compatible"] as const;
export type ProviderType = (typeof providerTypes)[number];

const providerSchema = z.object({
  type: z.enum(providerTypes).default("openai-chat"),
  model: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
  maxOutputTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().positive().default(120_000),
  maxRetries: z.number().int().min(0).max(6).default(2),
  jsonMode: z.boolean().default(false),
  headers: z.record(z.string(), z.string()).default({}),
});

const reviewSchema = z.object({
  minConfidence: z.number().min(0).max(1).default(0.6),
  verify: z.boolean().default(true),
  maxVerifications: z.number().int().min(0).default(20),
  security: z.enum(["auto", "always", "off"]).default("auto"),
  language: z.string().min(1).default("zh-CN"),
  maxFindings: z.number().int().positive().default(30),
  maxFilesPerBatch: z.number().int().positive().default(6),
  maxBatchChars: z.number().int().positive().default(60_000),
  maxToolSteps: z.number().int().min(0).default(6),
  concurrency: z.number().int().positive().default(3),
  contextCharBudget: z.number().int().positive().default(30_000),
  maxFileBytes: z.number().int().positive().default(300_000),
  reviewTimeoutMs: z.number().int().positive().default(900_000),
  rulesFiles: z.array(z.string()).default([".crv/rules.md", ".crv/rules.json"]),
  ignore: z
    .array(z.string())
    .default([
      "**/package-lock.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
      "**/Cargo.lock",
      "**/poetry.lock",
      "**/go.sum",
      "**/*.min.js",
      "**/*.min.css",
      "**/*.map",
      "**/*.snap",
      "**/*.svg",
      "**/*.png",
      "**/*.jpg",
      "**/*.gif",
      "**/*.ico",
      "**/*.pdf",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      ".crv/**",
    ]),
});

const checkSchema = z.object({
  name: z.string().regex(/^[\w.-]+$/),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().default(120_000),
});

export const configSchema = z.object({
  provider: providerSchema.default({}),
  review: reviewSchema.default({}),
  checks: z.array(checkSchema).default([]),
});

export type Config = z.infer<typeof configSchema>;
export type ProviderConfig = Config["provider"];
export type ReviewConfig = Config["review"];
export type CheckConfig = Config["checks"][number];

export const rulesFileSchema = z
  .object({
    include: z.array(z.string().min(1)).default([]),
    exclude: z.array(z.string().min(1)).default([]),
    rules: z
      .array(
        z
          .object({
            path: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
            rule: z.string().trim().min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type RulesFile = z.infer<typeof rulesFileSchema>;
