import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PageSchema, type Page } from "@cac/shared";

export type PageWithEtag = { page: Page; etag: string };
export type WriteIfMatchResult =
  | { ok: true; etag: string }
  | { ok: false; etag: string | null; page: Page | null };

export class ProjectStore {
  private readonly dataDirAbs: string;

  public constructor(dataDirAbs: string) {
    this.dataDirAbs = dataDirAbs;
  }

  private createWeakEtag(input: { mtimeMs: number; size: number }): string {
    const mtimeMs = Number.isFinite(input.mtimeMs) ? Math.round(input.mtimeMs) : 0;
    const size = Number.isFinite(input.size) ? Math.max(0, Math.round(input.size)) : 0;
    return `W/"${mtimeMs}-${size}"`;
  }

  public async listProjects(): Promise<string[]> {
    try {
      const entries = await readdir(this.dataDirAbs, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch (error) {
      const isMissing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT";
      if (isMissing) return [];
      throw error;
    }
  }

  public async ensureProject(projectId: string): Promise<void> {
    const projectDir = this.getProjectDir(projectId);
    await mkdir(projectDir, { recursive: true });
    await mkdir(path.join(projectDir, "assets"), { recursive: true });
  }

  public async readPage(projectId: string): Promise<Page> {
    const pagePath = this.getPagePath(projectId);
    const raw = await readFile(pagePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return PageSchema.parse(parsed);
  }

  public async readPageWithEtag(projectId: string): Promise<PageWithEtag> {
    const pagePath = this.getPagePath(projectId);
    const raw = await readFile(pagePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const page = PageSchema.parse(parsed);
    const s = await stat(pagePath);
    return { page, etag: this.createWeakEtag({ mtimeMs: s.mtimeMs, size: s.size }) };
  }

  public async writePage(projectId: string, page: Page): Promise<void> {
    const validated = PageSchema.parse(page);
    await this.ensureProject(projectId);
    const pagePath = this.getPagePath(projectId);
    await writeFile(pagePath, JSON.stringify(validated, null, 2) + "\n", "utf8");
  }

  public async writePageWithEtag(projectId: string, page: Page): Promise<string> {
    const validated = PageSchema.parse(page);
    await this.ensureProject(projectId);
    const pagePath = this.getPagePath(projectId);
    await writeFile(pagePath, JSON.stringify(validated, null, 2) + "\n", "utf8");
    const s = await stat(pagePath);
    return this.createWeakEtag({ mtimeMs: s.mtimeMs, size: s.size });
  }

  public async getPageEtag(projectId: string): Promise<string> {
    const pagePath = this.getPagePath(projectId);
    const s = await stat(pagePath);
    return this.createWeakEtag({ mtimeMs: s.mtimeMs, size: s.size });
  }

  public async writePageIfMatch(projectId: string, page: Page, expectedEtag: string): Promise<WriteIfMatchResult> {
    await this.ensureProject(projectId);
    let currentEtag: string | null = null;
    try {
      currentEtag = await this.getPageEtag(projectId);
    } catch (error) {
      const isMissing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT";
      if (!isMissing) throw error;
    }

    if (!currentEtag || currentEtag !== expectedEtag) {
      let currentPage: Page | null = null;
      try {
        currentPage = await this.readPage(projectId);
      } catch {
        currentPage = null;
      }
      return { ok: false, etag: currentEtag, page: currentPage };
    }

    const etag = await this.writePageWithEtag(projectId, page);
    return { ok: true, etag };
  }

  public getProjectDir(projectId: string): string {
    return path.join(this.dataDirAbs, projectId);
  }

  public getAssetsDir(projectId: string): string {
    return path.join(this.getProjectDir(projectId), "assets");
  }

  public getPagePath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), "page.json");
  }
}
