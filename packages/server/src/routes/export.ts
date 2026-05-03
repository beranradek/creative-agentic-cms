import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { z, type ZodType } from "zod";
import type { ProjectStore } from "../project-store.js";
import { normalizeBaseUrl } from "../export-config.js";
import { renderPageHtml } from "../render/render-page.js";

interface CreateExportRouterOptions {
  store: ProjectStore;
  projectIdSchema: ZodType<string>;
}

export function createExportRouter(options: CreateExportRouterOptions): express.Router {
  const { store, projectIdSchema } = options;
  const router = express.Router({ mergeParams: true });

  router.post("/", async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    z.object({}).passthrough().parse(req.body ?? {});

    const page = await store.readPage(projectId);
    const exportConfig = await store.readExportConfig(projectId);
    const { html, css } = renderPageHtml(page, {
      baseUrl: exportConfig.baseUrl,
      analyticsHtml: exportConfig.analyticsHtml,
      contactForm: exportConfig.contactForm,
    });

    const outputDir = path.join(store.getProjectDir(projectId), "output");
    const outputAssetsDir = path.join(outputDir, "assets");
    await mkdir(outputAssetsDir, { recursive: true });

    await writeFile(path.join(outputDir, "index.html"), html, "utf8");
    await writeFile(path.join(outputDir, "styles.css"), css + "\n", "utf8");

    await cp(store.getAssetsDir(projectId), outputAssetsDir, { recursive: true, force: true });

    if (exportConfig.includeRobotsTxt) {
      const robotsLines: string[] = [];
      robotsLines.push("User-agent: *");
      robotsLines.push(exportConfig.allowIndexing ? "Allow: /" : "Disallow: /");
      if (exportConfig.includeSitemap && exportConfig.baseUrl) {
        const base = normalizeBaseUrl(exportConfig.baseUrl);
        robotsLines.push(`Sitemap: ${base}/sitemap.xml`);
      }
      await writeFile(path.join(outputDir, "robots.txt"), robotsLines.join("\n") + "\n", "utf8");
    }

    if (exportConfig.includeSitemap && exportConfig.baseUrl) {
      const base = normalizeBaseUrl(exportConfig.baseUrl);
      const loc = `${base}/`;
      const lastmod = new Date().toISOString().slice(0, 10);
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `  <url>\n` +
        `    <loc>${loc}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `  </url>\n` +
        `</urlset>\n`;
      await writeFile(path.join(outputDir, "sitemap.xml"), sitemap, "utf8");
    }

    res.json({ ok: true, outputDir: `projects/${projectId}/output` });
  });

  return router;
}
