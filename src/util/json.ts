function tryParse(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

function matchEnd(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    const value = tryParse(fenced[1].trim());
    if (value !== undefined) return value;
  }

  let attempts = 0;
  for (let i = 0; i < trimmed.length && attempts < 20; i++) {
    const c = trimmed[i];
    if (c !== "{" && c !== "[") continue;
    attempts++;
    const end = matchEnd(trimmed, i);
    if (end < 0) continue;
    const value = tryParse(trimmed.slice(i, end + 1));
    if (value !== undefined) return value;
  }
  return undefined;
}
