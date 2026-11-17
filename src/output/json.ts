import type { ReviewReport } from "../core/review/report";

export function renderJson(report: ReviewReport): string {
  return JSON.stringify(report, null, 2);
}
