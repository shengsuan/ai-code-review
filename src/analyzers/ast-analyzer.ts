import ts from "typescript";
import type { LineRange } from "./diff-analyzer";

export interface SymbolInfo {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
}

const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/i;

export function isScriptFile(filePath: string): boolean {
  return SCRIPT_FILE.test(filePath);
}

function scriptKind(filePath: string): ts.ScriptKind {
  if (/\.tsx$/i.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(filePath)) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/i.test(filePath)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function parse(filePath: string, content: string): ts.SourceFile {
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind(filePath));
}

function lineOf(sf: ts.SourceFile, position: number): number {
  return sf.getLineAndCharacterOfPosition(position).line + 1;
}

function isNamedFunctionValue(node: ts.Node): boolean {
  return (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) || ts.isPropertyDeclaration(node.parent))
  );
}

function isSymbolNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    isNamedFunctionValue(node)
  );
}

function symbolName(node: ts.Node, sf: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) {
    const owner = node.parent;
    return `${ts.isClassLike(owner) && owner.name ? owner.name.getText(sf) : "class"}.constructor`;
  }
  const target = isNamedFunctionValue(node) ? node.parent : node;
  const named = target as ts.Node & { name?: ts.Node };
  const own = named.name ? named.name.getText(sf) : "anonymous";
  const parent = node.parent;
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    if (ts.isClassLike(parent) && parent.name) return `${parent.name.getText(sf)}.${own}`;
  }
  return own;
}

function rangeNode(node: ts.Node): ts.Node {
  if (isNamedFunctionValue(node) && ts.isVariableDeclaration(node.parent)) {
    const list = node.parent.parent;
    const statement = list.parent;
    if (ts.isVariableDeclarationList(list) && ts.isVariableStatement(statement)) return statement;
  }
  return node;
}

export function enclosingSymbols(filePath: string, content: string, ranges: LineRange[]): SymbolInfo[] {
  const sf = parse(filePath, content);
  const found = new Map<number, SymbolInfo>();

  const innermost = (node: ts.Node, line: number): ts.Node | undefined => {
    let best: ts.Node | undefined;
    ts.forEachChild(node, (child) => {
      if (best) return;
      const start = lineOf(sf, child.getStart(sf));
      const end = lineOf(sf, child.getEnd());
      if (line >= start && line <= end) best = innermost(child, line);
    });
    return best ?? (isSymbolNode(node) ? node : undefined);
  };

  for (const range of ranges) {
    let line = range.start;
    while (line <= range.end) {
      const node = innermost(sf, line);
      if (!node) {
        line++;
        continue;
      }
      const outer = rangeNode(node);
      const startLine = lineOf(sf, outer.getStart(sf));
      const endLine = lineOf(sf, outer.getEnd());
      found.set(startLine, { name: symbolName(node, sf), kind: ts.SyntaxKind[node.kind] ?? "Node", startLine, endLine });
      line = Math.max(endLine, line) + 1;
    }
  }
  return [...found.values()].sort((a, b) => a.startLine - b.startLine);
}

export function importBlock(filePath: string, content: string, maxLines = 40): { startLine: number; endLine: number } | null {
  const sf = parse(filePath, content);
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      first = Math.min(first, lineOf(sf, statement.getStart(sf)));
      last = Math.max(last, lineOf(sf, statement.getEnd()));
    }
  }
  if (last === 0) return null;
  return { startLine: first, endLine: Math.min(last, first + maxLines - 1) };
}

export function referencedNames(filePath: string, content: string, ranges: LineRange[]): string[] {
  const sf = parse(filePath, content);
  const names = new Set<string>();
  const inRange = (node: ts.Node): boolean => {
    const start = lineOf(sf, node.getStart(sf));
    const end = lineOf(sf, node.getEnd());
    return ranges.some((r) => start <= r.end && end >= r.start);
  };
  const visit = (node: ts.Node): void => {
    if (!inRange(node)) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = node.expression;
      if (ts.isIdentifier(target)) names.add(target.text);
      else if (ts.isPropertyAccessExpression(target)) names.add(target.name.text);
    } else if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      names.add(node.typeName.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...names];
}
