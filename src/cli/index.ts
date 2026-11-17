#!/usr/bin/env node
import { Command } from "commander";
import { CrvError, errorMessage } from "../errors";
import { VERSION } from "../version";
import { registerConfig } from "./commands/config";
import { registerHistory } from "./commands/history";
import { registerReview } from "./commands/review";
import { registerServe } from "./commands/serve";

async function main(): Promise<void> {
  const program = new Command();
  program.name("crv").description("AI code review agent").version(VERSION).showHelpAfterError();
  registerReview(program);
  registerHistory(program);
  registerConfig(program);
  registerServe(program);
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  process.stderr.write(`error: ${errorMessage(error)}\n`);
  process.exitCode = error instanceof CrvError ? error.exitCode : 2;
});
