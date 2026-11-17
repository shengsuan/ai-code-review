import { promises as fs } from "node:fs";
import picomatch from "picomatch";
import type { GitAnalyzer, GitScope } from "../../analyzers/git-analyzer";
import { CrvError } from "../../errors";
import { isInside, normalizeRelative, resolveWithin } from "../../util/path";

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface SearchOptions {
  glob?: string;
  maxResults?: number;
  ignoreCase?: boolean;
}

export interface CodeSource {
  readonly kind: "worktree" | "git-ref";
  read(filePath: string): Promise<string | null>;
  search(pattern: string, options?: SearchOptions): Promise<SearchHit[]>;
}

export interface SourceLimits {
  maxFileBytes: number;
  ignore: string[];
}

const GREP_LINE = /^(.*?):(\d+):(.*)$/;

function toPosixRegex(pattern: string): string {
  return pattern
    .replace(/\\s/g, "[[:space:]]")
    .replace(/\\S/g, "[^[:space:]]")
    .replace(/\\d/g, "[0-9]")
    .replace(/\\w/g, "[[:alnum:]_]");
}

function validatePattern(pattern: string): void {
  if (!pattern || pattern.length > 500) throw new CrvError("Search pattern must be 1-500 characters");
  try {
    new RegExp(pattern);
  } catch {
    throw new CrvError(`Invalid regular expression: ${pattern}`);
  }
}

function validateGlob(glob: string | undefined): string | undefined {
  if (!glob) return undefined;
  if (glob.startsWith("/") || glob.includes("..") || glob.includes("\0") || glob.startsWith(":")) {
    throw new CrvError(`Invalid glob: ${glob}`);
  }
  return glob;
}

async function gitGrep(
  git: GitAnalyzer,
  scope: GitScope,
  pattern: string,
  options: SearchOptions,
  limits: SourceLimits,
): Promise<SearchHit[]> {
  validatePattern(pattern);
  const glob = validateGlob(options.glob);
  const args = ["grep", "-n", "-I", "--no-color", "-E", ...(options.ignoreCase ? ["-i"] : []), "-e", toPosixRegex(pattern)];
  if (scope.kind === "worktree") args.push("--untracked");
  else if (scope.kind === "index") args.push("--cached");
  else args.push(scope.ref);
  args.push("--");
  if (glob) args.push(`:(glob)${glob}`);

  const output = await git.run(args, [0, 1]);
  const prefix = scope.kind === "ref" ? `${scope.ref}:` : "";
  const isIgnored = picomatch(limits.ignore, { dot: true });
  const max = Math.min(options.maxResults ?? 30, 200);
  const hits: SearchHit[] = [];
  for (const raw of output.split("\n")) {
    if (!raw) continue;
    const line = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    const match = GREP_LINE.exec(line);
    if (!match || isIgnored(match[1] ?? "")) continue;
    hits.push({ path: match[1] ?? "", line: Number(match[2]), text: match[3] ?? "" });
    if (hits.length >= max) break;
  }
  return hits;
}

export class WorkingTreeSource implements CodeSource {
  readonly kind = "worktree" as const;
  private rootReal?: string;

  constructor(
    private readonly git: GitAnalyzer,
    private readonly limits: SourceLimits,
  ) {}

  async read(filePath: string): Promise<string | null> {
    const relative = normalizeRelative(filePath);
    if (!relative) return null;
    try {
      const absolute = resolveWithin(this.git.root, relative);
      const real = await fs.realpath(absolute);
      this.rootReal ??= await fs.realpath(this.git.root);
      if (!isInside(this.rootReal, real)) return null;
      const stat = await fs.stat(real);
      if (!stat.isFile() || stat.size > this.limits.maxFileBytes) return null;
      const buffer = await fs.readFile(real);
      return buffer.includes(0) ? null : buffer.toString("utf8");
    } catch {
      return null;
    }
  }

  search(pattern: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    return gitGrep(this.git, { kind: "worktree" }, pattern, options, this.limits);
  }
}

export class GitRefSource implements CodeSource {
  readonly kind = "git-ref" as const;

  constructor(
    private readonly git: GitAnalyzer,
    private readonly scope: Extract<GitScope, { kind: "ref" | "index" }>,
    private readonly limits: SourceLimits,
  ) {}

  async read(filePath: string): Promise<string | null> {
    const relative = normalizeRelative(filePath);
    if (!relative) return null;
    const spec = `${this.scope.kind === "ref" ? this.scope.ref : ""}:${relative}`;
    try {
      const content = await this.git.run(["cat-file", "blob", spec]);
      if (content.includes("\0") || Buffer.byteLength(content) > this.limits.maxFileBytes) return null;
      return content;
    } catch {
      return null;
    }
  }

  search(pattern: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    return gitGrep(this.git, this.scope, pattern, options, this.limits);
  }
}

export function createSource(git: GitAnalyzer, scope: GitScope, limits: SourceLimits): CodeSource {
  return scope.kind === "worktree" ? new WorkingTreeSource(git, limits) : new GitRefSource(git, scope, limits);
}
