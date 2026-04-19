import path from "node:path";
import { readFile } from "node:fs/promises";
import express from "express";
import { z, type ZodType } from "zod";
import { CircuitBreakerOpenError, runCmsAgent } from "@cac/agent";
import { PageSchema } from "@cac/shared";
import { createDefaultPage } from "../default-page.js";
import type { ProjectStore } from "../project-store.js";

interface CreateAgentRouterOptions {
  store: ProjectStore;
  projectIdSchema: ZodType<string>;
}

export function createAgentRouter(options: CreateAgentRouterOptions): express.Router {
  const { store, projectIdSchema } = options;
  const router = express.Router({ mergeParams: true });

  router.post("/chat", async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const body = z
      .object({
        message: z.string().min(1),
        screenshotUrl: z.string().min(1).optional(),
      })
      .parse(req.body);

    let page;
    try {
      page = await store.readPage(projectId);
    } catch {
      page = createDefaultPage();
    }

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

      const output = await runCmsAgent({
        userMessage: body.message,
        projectId,
        page,
        screenshotUrl: body.screenshotUrl,
        screenshotPngBase64,
      });

      const nextPage = PageSchema.parse(output.page);
      await store.writePage(projectId, nextPage);
      res.json({ assistantMessage: output.assistantMessage, page: nextPage });
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
