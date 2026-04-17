import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { z, type ZodType } from "zod";
import type { ProjectStore } from "../project-store.js";
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
    const _body = z.object({}).passthrough().parse(req.body ?? {});

    const page = await store.readPage(projectId);
    const { html, css } = renderPageHtml(page);

    const outputDir = path.join(store.getProjectDir(projectId), "output");
    const outputAssetsDir = path.join(outputDir, "assets");
    await mkdir(outputAssetsDir, { recursive: true });

    await writeFile(path.join(outputDir, "index.html"), html, "utf8");
    await writeFile(path.join(outputDir, "styles.css"), css + "\n", "utf8");

    await cp(store.getAssetsDir(projectId), outputAssetsDir, { recursive: true, force: true });

    res.json({ ok: true, outputDir: `projects/${projectId}/output` });
  });

  return router;
}

