import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { z, type ZodType } from "zod";
import type { ProjectStore } from "../project-store.js";
import { renderPageHtml } from "../render/render-page.js";

interface CreatePreviewRouterOptions {
  store: ProjectStore;
  projectIdSchema: ZodType<string>;
}

export function createPreviewRouter(options: CreatePreviewRouterOptions): express.Router {
  const { store, projectIdSchema } = options;
  const router = express.Router({ mergeParams: true });

  router.post("/screenshot", async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const body = z
      .object({
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      })
      .passthrough()
      .parse(req.body ?? {});

    const page = await store.readPage(projectId);
    const { html, css } = renderPageHtml(page);

    // Write a render artifact to a stable location for Playwright to load.
    const outputDirAbs = path.join(store.getProjectDir(projectId), "output");
    const outputAssetsDirAbs = path.join(outputDirAbs, "assets");
    await mkdir(outputAssetsDirAbs, { recursive: true });
    await writeFile(path.join(outputDirAbs, "index.html"), html, "utf8");
    await writeFile(path.join(outputDirAbs, "styles.css"), css + "\n", "utf8");
    await cp(store.getAssetsDir(projectId), outputAssetsDirAbs, { recursive: true, force: true });

    // Lazy-load Playwright so this endpoint can be optional in minimal installs.
    let playwright: typeof import("playwright") | null = null;
    try {
      playwright = (await import("playwright")) as typeof import("playwright");
    } catch {
      res.status(501).json({
        error:
          "Screenshot capture requires Playwright. Add dependency `playwright` and run `npx playwright install` (and on Linux possibly `npx playwright install-deps`).",
      });
      return;
    }

    const width = body.width ?? 1200;
    const height = body.height ?? 720;

    const screenshotsDirAbs = path.join(store.getProjectDir(projectId), ".workspace", "screenshots");
    await mkdir(screenshotsDirAbs, { recursive: true });
    const filename = `${Date.now()}_${Math.random().toString(16).slice(2)}.png`;
    const screenshotPathAbs = path.join(screenshotsDirAbs, filename);

    const browser = await playwright.chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(`file://${path.join(outputDirAbs, "index.html")}`, { waitUntil: "load" });
      await page.screenshot({ path: screenshotPathAbs, fullPage: true });
    } finally {
      await browser.close();
    }

    res.json({
      ok: true,
      screenshotUrl: `/projects/${encodeURIComponent(projectId)}/.workspace/screenshots/${encodeURIComponent(filename)}`,
    });
  });

  return router;
}
