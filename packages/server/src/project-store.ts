import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PageSchema, type Page } from "@cac/shared";

export class ProjectStore {
  private readonly dataDirAbs: string;

  public constructor(dataDirAbs: string) {
    this.dataDirAbs = dataDirAbs;
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

  public async writePage(projectId: string, page: Page): Promise<void> {
    const validated = PageSchema.parse(page);
    await this.ensureProject(projectId);
    const pagePath = this.getPagePath(projectId);
    await writeFile(pagePath, JSON.stringify(validated, null, 2) + "\n", "utf8");
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

