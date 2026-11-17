import { type FileDiff, type LineRange, addedText } from "../../analyzers/diff-analyzer";
import { enclosingSymbols, isScriptFile, referencedNames } from "../../analyzers/ast-analyzer";
import { numberLines, splitLines } from "../../util/text";
import type { CodeSource } from "./source";

export interface ContextSection {
  path: string;
  title: string;
  content: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const STOP_WORDS = new Set(
  (
    "if for while switch catch return function typeof new await async class import export require console log error warn info debug " +
    "Promise Array Object String Number Boolean Map Set Date JSON Math Error RegExp Symbol parseInt parseFloat setTimeout setInterval " +
    "push pop shift map filter reduce forEach includes join split slice splice concat keys values entries get has then catch finally " +
    "print len range str int float list dict self this super test describe it expect assert println printf fmt Println Sprintf make append " +
    "String Vec Some None Ok Err Result Option Box Self main"
  ).split(" "),
);

export function definitionPattern(name: string): string {
  return [
    `\\b(function|class|interface|type|enum|def|func|fn|struct|trait|const|let|var)\\s+${name}\\b`,
    `\\b${name}\\s*[:=]\\s*(async\\s*)?(function\\b|\\()`,
    `\\b(public|private|protected|static|async)\\s+${name}\\s*\\(`,
    `\\bfunc\\s*\\([^)]*\\)\\s*${name}\\b`,
  ].join("|");
}

function usableName(name: string): boolean {
  return IDENTIFIER.test(name) && name.length >= 3 && !STOP_WORDS.has(name);
}

function candidateNames(file: FileDiff, content: string, ranges: LineRange[]): string[] {
  if (isScriptFile(file.path)) return referencedNames(file.path, content, ranges).filter(usableName);
  const text = addedText(file);
  const names = new Set<string>();
  for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) names.add(match[1] ?? "");
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9]{2,})\b/g)) names.add(match[1] ?? "");
  return [...names].filter(usableName);
}

function snippetAround(filePath: string, content: string, line: number): string {
  const lines = splitLines(content);
  if (isScriptFile(filePath)) {
    const symbol = enclosingSymbols(filePath, content, [{ start: line, end: line }])[0];
    if (symbol) {
      const end = Math.min(symbol.endLine, symbol.startLine + 59);
      return numberLines(lines.slice(symbol.startLine - 1, end), symbol.startLine);
    }
  }
  const start = Math.max(1, line - 2);
  const end = Math.min(lines.length, line + 27);
  return numberLines(lines.slice(start - 1, end), start);
}

export class SymbolResolver {
  constructor(private readonly source: CodeSource) {}

  async definitions(file: FileDiff, content: string, ranges: LineRange[], limit: number): Promise<ContextSection[]> {
    const names = candidateNames(file, content, ranges)
      .filter((name) => !new RegExp(definitionPattern(name)).test(content))
      .slice(0, limit * 3);
    const sections: ContextSection[] = [];
    for (const name of names) {
      if (sections.length >= limit) break;
      const hits = await this.source.search(definitionPattern(name), { maxResults: 8 });
      const hit = hits.find((h) => h.path !== file.path);
      if (!hit) continue;
      const body = await this.source.read(hit.path);
      if (!body) continue;
      sections.push({ path: hit.path, title: `definition of ${name} (${hit.path}:${hit.line})`, content: snippetAround(hit.path, body, hit.line) });
    }
    return sections;
  }

  async callers(names: string[], filePath: string, own: LineRange[], limit = 10): Promise<ContextSection | null> {
    const lines: string[] = [];
    for (const name of [...new Set(names)].filter(usableName).slice(0, 4)) {
      const hits = await this.source.search(`\\b${name}\\s*\\(`, { maxResults: 25 });
      const definition = new RegExp(definitionPattern(name));
      for (const hit of hits) {
        if (hit.path === filePath && own.some((r) => hit.line >= r.start && hit.line <= r.end)) continue;
        if (definition.test(hit.text)) continue;
        lines.push(`${hit.path}:${hit.line}: ${hit.text.trim().slice(0, 160)}`);
        if (lines.length >= limit) break;
      }
      if (lines.length >= limit) break;
    }
    return lines.length > 0 ? { path: filePath, title: "callers of changed symbols", content: lines.join("\n") } : null;
  }
}
