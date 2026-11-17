export class CrvError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends CrvError {}

export class GitError extends CrvError {}

export class PathError extends CrvError {}

export class ProviderError extends CrvError {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
