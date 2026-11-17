import { promises as fs } from "node:fs";
import path from "node:path";
import { CrvError } from "../../errors";
import type { ReviewFinding } from "./finding";
import type { ReviewReport } from "./report";

export interface ReviewSummary {
  id: string;
  createdAt: string;
  mode: string;
  label: string;
  totalFindings: number;
}

const ID_PATTERN = /^rv_[a-z0-9]+$/;

export class ReviewStore {
  private readonly dir: string;

  constructor(root: string) {
    this.dir = path.join(root, ".crv", "reviews");
  }

  async save(report: ReviewReport): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(path.dirname(this.dir), ".gitignore"), "reviews/\n", { flag: "a" });
    const target = path.join(this.dir, `${report.id}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(report, null, 2));
    await fs.rename(temp, target);
  }

  async list(limit = 20): Promise<ReviewSummary[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).filter((id) => ID_PATTERN.test(id));
    const reports = await Promise.all(ids.map((id) => this.get(id).catch(() => null)));
    return reports
      .filter((r): r is ReviewReport => r !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => ({ id: r.id, createdAt: r.createdAt, mode: r.target.mode, label: r.target.label, totalFindings: r.summary.totalFindings }));
  }

  async get(id: string): Promise<ReviewReport> {
    const resolved = id === "latest" ? (await this.list(1))[0]?.id : id;
    if (!resolved || !ID_PATTERN.test(resolved)) throw new CrvError(id === "latest" ? "No saved reviews" : `Invalid review id: ${id}`, 1);
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, `${resolved}.json`), "utf8")) as ReviewReport;
    } catch {
      throw new CrvError(`Review not found: ${id}`, 1);
    }
  }

  async findFinding(findingId: string, reviewId?: string): Promise<{ report: ReviewReport; finding: ReviewFinding } | null> {
    const candidates = reviewId ? [reviewId] : (await this.list(50)).map((s) => s.id);
    for (const id of candidates) {
      const report = await this.get(id);
      const finding = report.findings.find((f) => f.id === findingId);
      if (finding) return { report, finding };
    }
    return null;
  }
}
