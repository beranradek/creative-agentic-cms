import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import express from "express";
import { z, type ZodType } from "zod";
import { CircuitBreakerOpenError, runCmsAgent, summarizePageDiff, validateAgentEdit, type DiffBudget } from "@cac/agent";
import { PageSchema } from "@cac/shared";
import { createDefaultPage } from "../default-page.js";
import type { ProjectStore } from "../project-store.js";
import {
  cleanupStagedPlaceholderFiles,
  finalizeStagedPlaceholderFiles,
  stageMissingSvgPlaceholderAssets,
} from "../placeholder-materialize.js";
import { renderPageHtml } from "../render/render-page.js";

interface CreateAgentRouterOptions {
  store: ProjectStore;
  projectIdSchema: ZodType<string>;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 1)) + "…";
}

function extractMarkupExcerpt(html: string, maxChars: number): string {
  const start = html.indexOf("<main");
  const end = html.indexOf("</main>");
  const excerpt = start >= 0 && end > start ? html.slice(start, end + "</main>".length) : html;
  return truncate(excerpt.replace(/\s+\n/g, "\n").trim(), maxChars);
}

export function createAgentRouter(options: CreateAgentRouterOptions): express.Router {
  const { store, projectIdSchema } = options;
  const router = express.Router({ mergeParams: true });

  router.post("/apply", async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const body = z
      .object({
        message: z.string().min(1),
        basePage: PageSchema,
        proposedPage: PageSchema,
      })
      .parse(req.body);

    let currentPageWithEtag;
    try {
      currentPageWithEtag = await store.readPageWithEtag(projectId);
    } catch {
      const page = createDefaultPage();
      const etag = await store.writePageWithEtag(projectId, page);
      currentPageWithEtag = { page, etag };
    }
    const currentPage = currentPageWithEtag.page;
    const currentEtag = currentPageWithEtag.etag;
    res.setHeader("ETag", currentEtag);

    const expectedEtag = z.string().min(1).optional().parse(req.header("if-match"));
    if (expectedEtag && expectedEtag !== currentEtag) {
      res.status(409).json({ error: "conflict", page: currentPage });
      return;
    }

    if (JSON.stringify(currentPage) !== JSON.stringify(body.basePage)) {
      res.status(409).json({ error: "conflict", page: currentPage });
      return;
    }

    const budget: DiffBudget = {
      maxSectionAdds: 1,
      maxSectionDeletes: 0,
      maxSectionEdits: 4,
      maxComponentAdds: 4,
      maxComponentDeletes: 0,
      maxComponentMovesBetweenSections: 2,
      maxComponentEdits: 10,
      maxAssetAdds: 4,
      maxAssetDeletes: 0,
      maxAssetEdits: 6,
      maxApproxJsonDeltaChars: 25_000,
    };

    try {
      const { summary } = validateAgentEdit(body.basePage, body.proposedPage, body.message, { budget });

      await store.ensureProject(projectId);
      const assetsDir = store.getAssetsDir(projectId);
      await mkdir(assetsDir, { recursive: true });
      const stagedPlaceholders = await stageMissingSvgPlaceholderAssets(assetsDir, body.proposedPage.assets);

      const writeResult = await store.writePageIfMatch(projectId, body.proposedPage, currentEtag);
      if (!writeResult.ok) {
        await cleanupStagedPlaceholderFiles(stagedPlaceholders);
        if (writeResult.etag) res.setHeader("ETag", writeResult.etag);
        res.status(409).json({ error: "conflict", page: writeResult.page });
        return;
      }
      await finalizeStagedPlaceholderFiles(stagedPlaceholders);

      res.setHeader("ETag", writeResult.etag);
      res.json({ ok: true, applied: true, page: body.proposedPage, diffSummary: summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent edit rejected by guardrails.";
      res.status(400).json({ error: message });
    }
  });

  router.post("/chat", async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const body = z
      .object({
        message: z.string().min(1),
        screenshotUrl: z.string().min(1).optional(),
        mode: z.enum(["suggest", "apply"]).optional().default("apply"),
      })
      .parse(req.body);

    let pageWithEtag;
    try {
      pageWithEtag = await store.readPageWithEtag(projectId);
    } catch {
      const page = createDefaultPage();
      const etag = await store.writePageWithEtag(projectId, page);
      pageWithEtag = { page, etag };
    }
    const page = pageWithEtag.page;
    const baseEtag = pageWithEtag.etag;
    res.setHeader("ETag", baseEtag);

    try {
      let screenshotPngBase64: string | undefined;
      if (body.screenshotUrl) {
        const expectedPrefix = `/projects/${encodeURIComponent(projectId)}/.workspace/screenshots/`;
        const raw = body.screenshotUrl;
        if (raw.startsWith(expectedPrefix)) {
          const encodedFilename = raw.slice(expectedPrefix.length);
          const filename = decodeURIComponent(encodedFilename);
          if (filename && filename === path.basename(filename)) {
            const screenshotPathAbs = path.join(store.getProjectDir(projectId), ".workspace", "screenshots", filename);
            try {
              const buf = await readFile(screenshotPathAbs);
              screenshotPngBase64 = buf.toString("base64");
            } catch {
              // Best-effort: ignore screenshot read failures.
            }
          }
        }
      }

      const { html } = renderPageHtml(page);
      const markupHtmlExcerpt = extractMarkupExcerpt(html, 6_000);

      const output = await runCmsAgent({
        userMessage: body.message,
        projectId,
        page,
        screenshotUrl: body.screenshotUrl,
        screenshotPngBase64,
        markupHtmlExcerpt,
      });

      if (output.kind === "request_screenshot") {
        res.json({
          assistantMessage: output.assistantMessage,
          applied: false,
          page,
          requestScreenshot: true,
          requestScreenshotReason: output.reason,
          requestScreenshotOptions: output.options,
        });
        return;
      }

      const nextPage = PageSchema.parse(output.page);
      if (body.mode === "apply") {
        const budget: DiffBudget = {
          maxSectionAdds: 1,
          maxSectionDeletes: 0,
          maxSectionEdits: 4,
          maxComponentAdds: 4,
          maxComponentDeletes: 0,
          maxComponentMovesBetweenSections: 2,
          maxComponentEdits: 10,
          maxAssetAdds: 4,
          maxAssetDeletes: 0,
          maxAssetEdits: 6,
          maxApproxJsonDeltaChars: 25_000,
        };

        try {
          const { summary } = validateAgentEdit(page, nextPage, body.message, { budget });

          await store.ensureProject(projectId);
          const assetsDir = store.getAssetsDir(projectId);
          await mkdir(assetsDir, { recursive: true });
          const stagedPlaceholders = await stageMissingSvgPlaceholderAssets(assetsDir, nextPage.assets);

          const writeResult = await store.writePageIfMatch(projectId, nextPage, baseEtag);
          if (!writeResult.ok) {
            await cleanupStagedPlaceholderFiles(stagedPlaceholders);
            if (writeResult.etag) res.setHeader("ETag", writeResult.etag);
            res.status(409).json({ error: "conflict", page: writeResult.page });
            return;
          }
          await finalizeStagedPlaceholderFiles(stagedPlaceholders);

          res.setHeader("ETag", writeResult.etag);
          res.json({ assistantMessage: output.assistantMessage, applied: true, page: nextPage, diffSummary: summary });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent edit rejected by guardrails.";
          res.status(400).json({ error: message });
          return;
        }
      } else {
        const diffSummary = summarizePageDiff(page, nextPage);
        res.json({
          assistantMessage: output.assistantMessage,
          applied: false,
          page,
          proposedPage: nextPage,
          diffSummary,
        });
      }
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        res.status(503).json({ error: "LLM temporarily unavailable", openUntilMs: error.openUntilMs });
        return;
      }
      console.error(`[agent] /chat failed for projectId=${projectId}`, error);
      res.status(500).json({
        error: "Agent request failed. Verify OPENAI_API_KEY/MODEL and check server logs for details.",
      });
    }
  });

  return router;
}
