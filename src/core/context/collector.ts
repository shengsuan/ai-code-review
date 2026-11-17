import { enclosingSymbols, importBlock, isScriptFile } from "../../analyzers/ast-analyzer";
import { type FileDiff, type LineRange, changedRanges } from "../../analyzers/diff-analyzer";
import { numberLines, splitLines } from "../../util/text";
import type { CodeSource } from "./source";
import { type ContextSection, SymbolResolver } from "./symbol-resolver";

export type { ContextSection } from "./symbol-resolver";

const FULL_FILE_LINES = 120;
const MAX_SYMBOL_LINES = 160;
const WINDOW_PAD = 25;

function windows(start: number, end: number, ranges: LineRange[], pad: number): LineRange[] {
  const padded = ranges
    .filter((r) => r.end >= start && r.start <= end)
    .map((r) => ({ start: Math.max(start, r.start - pad), end: Math.min(end, r.end + pad) }));
  const merged: LineRange[] = [];
  for (const w of padded) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end + 1) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

function renderWindows(lines: string[], parts: LineRange[]): string {
  return parts.map((w) => numberLines(lines.slice(w.start - 1, w.end), w.start)).join("\n   ...\n");
}

export class ContextCollector {
  private readonly resolver: SymbolResolver;

  constructor(private readonly source: CodeSource) {
    this.resolver = new SymbolResolver(source);
  }

  async collect(files: FileDiff[]): Promise<ContextSection[]> {
    const primary: ContextSection[] = [];
    const secondary: ContextSection[] = [];

    for (const file of files) {
      if (file.status === "deleted") continue;
      const content = await this.source.read(file.path);
      if (content === null) continue;
      const lines = splitLines(content);
      const ranges = changedRanges(file);
      const symbolRanges: LineRange[] = [];
      const symbolNames: string[] = [];

      if (lines.length <= FULL_FILE_LINES) {
        primary.push({ path: file.path, title: `full file ${file.path}`, content: numberLines(lines, 1) });
      } else if (isScriptFile(file.path)) {
        const block = importBlock(file.path, content);
        if (block) {
          primary.push({
            path: file.path,
            title: `imports of ${file.path}`,
            content: numberLines(lines.slice(block.startLine - 1, block.endLine), block.startLine),
          });
        }
        for (const symbol of enclosingSymbols(file.path, content, ranges)) {
          const span = symbol.endLine - symbol.startLine + 1;
          const parts = span <= MAX_SYMBOL_LINES ? [{ start: symbol.startLine, end: symbol.endLine }] : windows(symbol.startLine, symbol.endLine, ranges, 30);
          primary.push({
            path: file.path,
            title: `${symbol.kind} ${symbol.name} (${file.path}:${symbol.startLine}-${symbol.endLine})`,
            content: renderWindows(lines, parts),
          });
          symbolRanges.push({ start: symbol.startLine, end: symbol.endLine });
          symbolNames.push(symbol.name.split(".").pop() ?? symbol.name);
        }
      } else {
        const parts = windows(1, lines.length, ranges, WINDOW_PAD);
        primary.push({ path: file.path, title: `surrounding code of ${file.path}`, content: renderWindows(lines, parts) });
      }

      secondary.push(...(await this.resolver.definitions(file, content, ranges, 4)));
      const callers = await this.resolver.callers(symbolNames, file.path, symbolRanges);
      if (callers) secondary.push(callers);
    }
    return [...primary, ...secondary];
  }
}

export function renderContext(sections: ContextSection[], budget: number): string {
  const out: string[] = [];
  let used = 0;
  for (const section of sections) {
    const block = `#### ${section.title}\n${section.content}`;
    if (used + block.length > budget) {
      out.push("(additional context omitted: budget reached)");
      break;
    }
    out.push(block);
    used += block.length;
  }
  return out.join("\n\n");
}
