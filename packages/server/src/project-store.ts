import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PageSchema, type Page } from "@cac/shared";
import { sanitizeRichTextHtml } from "./sanitize/rich-text.js";

export type PageWithEtag = { page: Page; etag: string };
export type WriteIfMatchResult =
  | { ok: true; etag: string }
  | { ok: false; etag: string | null; page: Page | null };

export class ProjectStore {
  private readonly dataDirAbs: string;
  private readonly pageWriteQueue = new Map<string, Promise<unknown>>();

  public constructor(dataDirAbs: string) {
    this.dataDirAbs = dataDirAbs;
  }

  private async writeFileAtomic(pathAbs: string, contents: string): Promise<void> {
    const tmpPath = `${pathAbs}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await writeFile(tmpPath, contents, "utf8");
    await rename(tmpPath, pathAbs);
  }

  private enqueuePageWrite<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.pageWriteQueue.get(projectId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.pageWriteQueue.set(projectId, next as Promise<unknown>);
    return next.finally(() => {
      if (this.pageWriteQueue.get(projectId) === (next as Promise<unknown>)) {
        this.pageWriteQueue.delete(projectId);
      }
    });
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
    const page = PageSchema.parse(parsed);
    return this.sanitizePage(page);
  }

  public async readPageWithEtag(projectId: string): Promise<PageWithEtag> {
    const pagePath = this.getPagePath(projectId);
    const raw = await readFile(pagePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const page = this.sanitizePage(PageSchema.parse(parsed));
    const s = await stat(pagePath);
    return { page, etag: this.createWeakEtag({ mtimeMs: s.mtimeMs, size: s.size }) };
  }

  private sanitizePage(page: Page): Page {
    let changed = false;
    const nextSections = page.sections.map((section) => {
      let sectionChanged = false;
      const nextComponents = section.components.map((component) => {
        if (component.type !== "rich_text") return component;
        const clean = sanitizeRichTextHtml(component.html);
        if (clean === component.html) return component;
        changed = true;
        sectionChanged = true;
        return { ...component, html: clean };
      });
      if (!sectionChanged) return section;
      return { ...section, components: nextComponents };
    });

    if (!changed) return page;
    return { ...page, sections: nextSections };
  }

  private async writePageUnlocked(projectId: string, page: Page): Promise<void> {
    const validated = this.sanitizePage(PageSchema.parse(page));
    await this.ensureProject(projectId);
    const pagePath = this.getPagePath(projectId);
    await this.writeFileAtomic(pagePath, JSON.stringify(validated, null, 2) + "\n");
  }

  private async writePageWithEtagUnlocked(projectId: string, page: Page): Promise<string> {
    const validated = this.sanitizePage(PageSchema.parse(page));
    await this.ensureProject(projectId);
    const pagePath = this.getPagePath(projectId);
    await this.writeFileAtomic(pagePath, JSON.stringify(validated, null, 2) + "\n");
    const s = await stat(pagePath);
    return this.createWeakEtag({ mtimeMs: s.mtimeMs, size: s.size });
  }

  public async writePage(projectId: string, page: Page): Promise<void> {
    await this.enqueuePageWrite(projectId, async () => {
      await this.writePageUnlocked(projectId, page);
    });
  }

  public async writePageWithEtag(projectId: string, page: Page): Promise<string> {
    return this.enqueuePageWrite(projectId, async () => this.writePageWithEtagUnlocked(projectId, page));
  }

  public async getPageEtag(projectId: string): Promise<string> {
    const pagePath = this.getPagePath(projectId);
    const s = await stat(pagePath);
    return this.createWeakEtag({ mtimeMs: s.mtimeMs, size: s.size });
  }

  public async writePageIfMatch(projectId: string, page: Page, expectedEtag: string): Promise<WriteIfMatchResult> {
    return this.enqueuePageWrite(projectId, async () => {
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

      const etag = await this.writePageWithEtagUnlocked(projectId, page);
      return { ok: true, etag };
    });
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
