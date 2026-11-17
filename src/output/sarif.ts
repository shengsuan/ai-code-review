import type { Severity } from "../core/review/finding";
import { categories } from "../core/review/finding";
import type { ReviewReport } from "../core/review/report";
import { VERSION } from "../version";

const LEVELS: Record<Severity, "error" | "warning" | "note"> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
};

const SECURITY_SEVERITY: Record<Severity, string> = { critical: "9.5", high: "8.0", medium: "5.0", low: "2.0" };

function location(filePath: string, startLine: number, endLine: number) {
  return {
    physicalLocation: {
      artifactLocation: { uri: filePath, uriBaseId: "%SRCROOT%" },
      region: { startLine, endLine },
    },
  };
}

export function renderSarif(report: ReviewReport): string {
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "crv",
            version: VERSION,
            rules: categories.map((category) => ({
              id: `crv/${category}`,
              name: category,
              shortDescription: { text: `AI code review: ${category}` },
            })),
          },
        },
        results: report.findings.map((f) => ({
          ruleId: `crv/${f.category}`,
          level: LEVELS[f.severity],
          message: { text: [f.title, f.description, f.suggestion ? `Suggestion: ${f.suggestion}` : ""].filter(Boolean).join("\n\n") },
          locations: [location(f.filePath, f.startLine, f.endLine)],
          relatedLocations: (f.related ?? []).map((r, id) => ({ id, ...location(r.filePath, r.startLine, r.endLine) })),
          partialFingerprints: { "crvFindingId/v1": f.id },
          properties: {
            severity: f.severity,
            confidence: f.confidence,
            evidence: f.evidence,
            "security-severity": SECURITY_SEVERITY[f.severity],
          },
        })),
        properties: { reviewId: report.id, target: report.target.label },
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}
