import { GitAnalyzer } from "../analyzers/git-analyzer";
import { type Overrides, loadConfig } from "../config/loader";
import type { Config } from "../config/schema";
import { createProvider } from "../providers";
import type { LLMProvider } from "../providers";
import { ReviewStore } from "./review/store";

export interface Runtime {
  root: string;
  config: Config;
  store: ReviewStore;
  provider(): LLMProvider;
}

export async function createRuntime(cwd: string, overrides: Overrides = {}): Promise<Runtime> {
  const git = await GitAnalyzer.open(cwd);
  const config = await loadConfig(git.root, overrides);
  let provider: LLMProvider | undefined;
  return {
    root: git.root,
    config,
    store: new ReviewStore(git.root),
    provider: () => (provider ??= createProvider(config.provider)),
  };
}
