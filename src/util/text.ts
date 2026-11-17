export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

export function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function numberLines(lines: readonly string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length;
  return lines.map((line, i) => `${String(startLine + i).padStart(width)}| ${line}`).join("\n");
}

function trigrams(text: string): Map<string, number> {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const grams = new Map<string, number>();
  if (normalized.length < 3) {
    if (normalized) grams.set(normalized, 1);
    return grams;
  }
  for (let i = 0; i <= normalized.length - 3; i++) {
    const gram = normalized.slice(i, i + 3);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

export function similarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  let sizeX = 0;
  let sizeY = 0;
  let shared = 0;
  for (const n of x.values()) sizeX += n;
  for (const n of y.values()) sizeY += n;
  if (sizeX === 0 || sizeY === 0) return 0;
  for (const [gram, n] of x) shared += Math.min(n, y.get(gram) ?? 0);
  return (2 * shared) / (sizeX + sizeY);
}
