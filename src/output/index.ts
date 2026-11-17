import type { ReviewReport } from "../core/review/report";
import { renderJson } from "./json";
import { renderSarif } from "./sarif";
import { renderTerminal } from "./terminal";

export const outputFormats = ["terminal", "json", "sarif"] as const;
export type OutputFormat = (typeof outputFormats)[number];

export function renderReport(report: ReviewReport, format: OutputFormat, options: { color: boolean }): string {
  switch (format) {
    case "json":
      return renderJson(report);
    case "sarif":
      return renderSarif(report);
    case "terminal":
      return renderTerminal(report, options);
  }
}

export { renderJson, renderSarif, renderTerminal };
