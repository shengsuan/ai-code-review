import picomatch from "picomatch";

export type DiffLineType = "add" | "del" | "ctx";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

export interface LineRange {
  start: number;
  end: number;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function cleanPath(raw: string): string {
  let value = raw.replace(/\t.*$/, "").trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value) as string;
    } catch {
      value = value.slice(1, -1);
    }
  }
  return /^[ab]\//.test(value) ? value.slice(2) : value;
}

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: Hunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  let remainingOld = 0;
  let remainingNew = 0;
  let minusPath: string | undefined;

  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("\\")) continue;

    if (file && hunk && (remainingOld > 0 || remainingNew > 0)) {
      const marker = line[0];
      if (marker === "+") {
        hunk.lines.push({ type: "add", content: line.slice(1), newLine: newNo++ });
        file.additions++;
        remainingNew--;
        continue;
      }
      if (marker === "-") {
        hunk.lines.push({ type: "del", content: line.slice(1), oldLine: oldNo++ });
        file.deletions++;
        remainingOld--;
        continue;
      }
      if (marker === " " || line === "") {
        hunk.lines.push({ type: "ctx", content: line.slice(1), oldLine: oldNo++, newLine: newNo++ });
        remainingOld--;
        remainingNew--;
        continue;
      }
    }

    const header = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if (header) {
      file = { path: header[2] ?? "", status: "modified", binary: false, hunks: [], additions: 0, deletions: 0 };
      files.push(file);
      hunk = undefined;
      minusPath = undefined;
      remainingOld = 0;
      remainingNew = 0;
      continue;
    }
    if (!file) continue;

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      const oldStart = Number(hunkMatch[1]);
      const oldLines = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      const newStart = Number(hunkMatch[3]);
      const newLines = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
      hunk = { oldStart, oldLines, newStart, newLines, lines: [] };
      file.hunks.push(hunk);
      oldNo = oldStart;
      newNo = newStart;
      remainingOld = oldLines;
      remainingNew = newLines;
      continue;
    }
    if (hunk && (remainingOld > 0 || remainingNew > 0)) continue;

    if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.oldPath = cleanPath(line.slice(12));
    } else if (line.startsWith("rename to ")) file.path = cleanPath(line.slice(10));
    else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) file.binary = true;
    else if (line.startsWith("--- ")) minusPath = line.slice(4);
    else if (line.startsWith("+++ ")) {
      const plus = line.slice(4);
      if (plus.trim() !== "/dev/null") file.path = cleanPath(plus);
      else if (minusPath && minusPath.trim() !== "/dev/null") file.path = cleanPath(minusPath);
    }
  }
  return files;
}

function renderLine(line: DiffLine): string {
  const number = line.newLine === undefined ? "" : String(line.newLine);
  const marker = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  return `${number.padStart(6)} ${marker} ${line.content}`;
}

export function renderFileDiff(file: FileDiff): string {
  const title =
    file.status === "renamed" && file.oldPath ? `### ${file.oldPath} -> ${file.path} (renamed)` : `### ${file.path} (${file.status})`;
  const body = file.hunks.flatMap((h) => [
    `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    ...h.lines.map(renderLine),
  ]);
  return [title, ...body].join("\n");
}

export function changedRanges(file: FileDiff): LineRange[] {
  const points: number[] = [];
  for (const hunk of file.hunks) {
    let cursor = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.type === "add" && line.newLine !== undefined) {
        points.push(line.newLine);
        cursor = line.newLine + 1;
      } else if (line.type === "del") points.push(cursor);
      else if (line.newLine !== undefined) cursor = line.newLine + 1;
    }
  }
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  const ranges: LineRange[] = [];
  for (const point of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && point <= last.end + 1) last.end = point;
    else ranges.push({ start: point, end: point });
  }
  return ranges;
}

export function addedText(file: FileDiff): string {
  return file.hunks
    .flatMap((h) => h.lines)
    .filter((l) => l.type === "add")
    .map((l) => l.content)
    .join("\n");
}

export function synthesizeNewFileDiff(filePath: string, content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return "";
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    "",
  ].join("\n");
}

export function filterDiffs(diffs: FileDiff[], ignore: string[]): { kept: FileDiff[]; skipped: SkippedFile[] } {
  const isIgnored = picomatch(ignore, { dot: true });
  const kept: FileDiff[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of diffs) {
    if (isIgnored(file.path)) skipped.push({ path: file.path, reason: "ignored by configuration" });
    else if (file.binary) skipped.push({ path: file.path, reason: "binary file" });
    else if (file.status === "deleted") skipped.push({ path: file.path, reason: "deleted file" });
    else if (file.hunks.length === 0) skipped.push({ path: file.path, reason: "no textual changes" });
    else kept.push(file);
  }
  return { kept, skipped };
}
