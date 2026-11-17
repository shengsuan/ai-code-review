import { type FileDiff, addedText, renderFileDiff } from "../../analyzers/diff-analyzer";
import type { ReviewConfig } from "../../config/schema";

export type ReviewPass = "general" | "security";

export interface ReviewBatch {
  id: number;
  files: FileDiff[];
  diffText: string;
  passes: ReviewPass[];
}

export interface ReviewPlan {
  batches: ReviewBatch[];
  warnings: string[];
}

const RISKY_CODE =
  /\b(eval|exec|execSync|spawn|system|popen|subprocess|child_process|innerHTML|dangerouslySetInnerHTML|deserialize|unserialize|pickle|yaml\.load|crypto|createHash|jwt|bcrypt|password|passwd|secret|token|api[_-]?key|authorization|cookie|session|sql|query|SELECT|INSERT|UPDATE|DELETE|redirect|cors|upload|readFile|writeFile|fetch|axios|request|req\.|res\.|process\.env)\b/i;
const RISKY_PATH = /(auth|login|passw|token|secret|crypto|session|permission|acl|rbac|oauth|jwt|admin|middleware|security|sql|db|payment|upload)/i;

function isSecuritySensitive(file: FileDiff): boolean {
  return RISKY_PATH.test(file.path) || RISKY_CODE.test(addedText(file));
}

export function planReview(diffs: FileDiff[], config: ReviewConfig): ReviewPlan {
  const warnings: string[] = [];
  const entries = [...diffs]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      let text = renderFileDiff(file);
      if (text.length > config.maxBatchChars) {
        text = `${text.slice(0, config.maxBatchChars)}\n[diff truncated]`;
        warnings.push(`Diff of ${file.path} was truncated for review`);
      }
      return { file, text };
    });

  const groups: Array<typeof entries> = [];
  let current: typeof entries = [];
  let size = 0;
  for (const entry of entries) {
    const full = current.length >= config.maxFilesPerBatch || size + entry.text.length > config.maxBatchChars;
    if (current.length > 0 && full) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += entry.text.length;
  }
  if (current.length > 0) groups.push(current);

  const batches = groups.map((group, index): ReviewBatch => {
    const passes: ReviewPass[] = ["general"];
    if (config.security === "always" || (config.security === "auto" && group.some((e) => isSecuritySensitive(e.file)))) {
      passes.push("security");
    }
    return { id: index + 1, files: group.map((e) => e.file), diffText: group.map((e) => e.text).join("\n\n"), passes };
  });
  return { batches, warnings };
}
