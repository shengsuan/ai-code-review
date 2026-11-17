import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CrvError, GitError } from "../errors";
import { resolveWithin, toPosix } from "../util/path";
import { synthesizeNewFileDiff } from "./diff-analyzer";

export type ReviewTarget =
  | { kind: "workspace" }
  | { kind: "staged" }
  | { kind: "range"; base: string; head?: string }
  | { kind: "commit"; commit: string }
  | { kind: "file"; filePath: string };

export type GitScope = { kind: "worktree" } | { kind: "index" } | { kind: "ref"; ref: string };

export interface TargetResolution {
  mode: ReviewTarget["kind"];
  label: string;
  diff: string;
  scope: GitScope;
}

export interface DiffLimits {
  maxFileBytes: number;
}

const DIFF_ARGS = ["diff", "--no-color", "--no-ext-diff", "-U5", "--find-renames"];
const MAX_UNTRACKED = 200;

function execGit(cwd: string, args: string[], okCodes: number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.quotepath=off", "--no-pager", ...args],
      { cwd, maxBuffer: 256 * 1024 * 1024, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
        if (typeof code === "number" && okCodes.includes(code)) {
          resolve(stdout);
          return;
        }
        if (code === "ENOENT") reject(new GitError("git executable not found"));
        else reject(new GitError(stderr.trim() || error.message));
      },
    );
  });
}

function assertRef(ref: string): void {
  if (!/^(?!-)[^\s\x00-\x1f\x7f]+$/.test(ref)) throw new GitError(`Invalid git revision: ${ref}`);
}

export class GitAnalyzer {
  private constructor(readonly root: string) {}

  static async open(cwd: string): Promise<GitAnalyzer> {
    let top: string;
    try {
      top = await execGit(cwd, ["rev-parse", "--show-toplevel"], [0]);
    } catch (error) {
      if (error instanceof GitError && error.message.includes("not found")) throw error;
      throw new GitError(`Not a git repository: ${cwd}`);
    }
    return new GitAnalyzer(path.resolve(top.trim()));
  }

  run(args: string[], okCodes: number[] = [0]): Promise<string> {
    return execGit(this.root, args, okCodes);
  }

  async resolveCommit(ref: string): Promise<string> {
    assertRef(ref);
    try {
      return (await this.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim();
    } catch {
      throw new GitError(`Cannot resolve revision: ${ref}`);
    }
  }

  private async hasHead(): Promise<boolean> {
    try {
      await this.run(["rev-parse", "--verify", "--quiet", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  async resolveTarget(target: ReviewTarget, limits: DiffLimits): Promise<TargetResolution> {
    switch (target.kind) {
      case "workspace":
        return this.workspace(limits);
      case "staged":
        return {
          mode: "staged",
          label: "staged changes",
          diff: await this.run([...DIFF_ARGS, "--cached", "--"]),
          scope: { kind: "index" },
        };
      case "range": {
        const base = await this.resolveCommit(target.base);
        const head = await this.resolveCommit(target.head ?? "HEAD");
        return {
          mode: "range",
          label: `${target.base}...${target.head ?? "HEAD"}`,
          diff: await this.run([...DIFF_ARGS, `${base}...${head}`, "--"]),
          scope: { kind: "ref", ref: head },
        };
      }
      case "commit": {
        const sha = await this.resolveCommit(target.commit);
        const subject = (await this.run(["log", "-1", "--format=%h %s", sha])).trim();
        return {
          mode: "commit",
          label: `commit ${subject}`,
          diff: await this.run(["show", "--format=", "--no-color", "--no-ext-diff", "-U5", "--find-renames", "-m", "--first-parent", sha, "--"]),
          scope: { kind: "ref", ref: sha },
        };
      }
      case "file":
        return this.file(target.filePath, limits);
    }
  }

  private async workspace(limits: DiffLimits): Promise<TargetResolution> {
    const tracked = (await this.hasHead())
      ? await this.run([...DIFF_ARGS, "HEAD", "--"])
      : (await this.run([...DIFF_ARGS, "--cached", "--"])) + (await this.run([...DIFF_ARGS, "--"]));
    const untracked = await this.untrackedDiffs(limits.maxFileBytes);
    const diff = [tracked, untracked].filter((part) => part.trim().length > 0).join("\n");
    return { mode: "workspace", label: "working tree changes", diff, scope: { kind: "worktree" } };
  }

  private async untrackedDiffs(maxFileBytes: number): Promise<string> {
    const listing = await this.run(["ls-files", "--others", "--exclude-standard", "-z"]);
    const names = listing.split("\0").filter(Boolean).slice(0, MAX_UNTRACKED);
    const parts: string[] = [];
    for (const name of names) {
      try {
        const absolute = resolveWithin(this.root, name);
        const stat = await fs.stat(absolute);
        if (!stat.isFile() || stat.size > maxFileBytes) continue;
        const buffer = await fs.readFile(absolute);
        if (buffer.includes(0)) continue;
        parts.push(synthesizeNewFileDiff(name, buffer.toString("utf8")));
      } catch {
        continue;
      }
    }
    return parts.join("\n");
  }

  private async file(filePath: string, limits: DiffLimits): Promise<TargetResolution> {
    const absolute = resolveWithin(this.root, filePath);
    let buffer: Buffer;
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) throw new CrvError(`Not a file: ${filePath}`);
      if (stat.size > limits.maxFileBytes) throw new CrvError(`File too large to review: ${filePath}`);
      buffer = await fs.readFile(absolute);
    } catch (error) {
      if (error instanceof CrvError) throw error;
      throw new CrvError(`File not found: ${filePath}`);
    }
    if (buffer.includes(0)) throw new CrvError(`Binary file cannot be reviewed: ${filePath}`);
    const relative = toPosix(path.relative(this.root, absolute));
    return {
      mode: "file",
      label: `file ${relative}`,
      diff: synthesizeNewFileDiff(relative, buffer.toString("utf8")),
      scope: { kind: "worktree" },
    };
  }
}
