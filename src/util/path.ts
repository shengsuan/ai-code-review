import path from "node:path";
import { PathError } from "../errors";

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === "") return true;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function resolveWithin(root: string, relative: string): string {
  if (relative.includes("\0")) throw new PathError("Invalid path");
  const absolute = path.resolve(root, relative);
  if (!isInside(root, absolute)) throw new PathError(`Path escapes workspace: ${relative}`);
  return absolute;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function normalizeRelative(p: string): string | null {
  const unified = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!unified || unified.includes("\0") || path.posix.isAbsolute(unified)) return null;
  const normalized = path.posix.normalize(unified);
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}
