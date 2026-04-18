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
      const output = await runCmsAgent({
        userMessage: body.message,
        projectId,
        page,
        screenshotUrl: body.screenshotUrl,
      });

      const nextPage = PageSchema.parse(output.page);
      await store.writePage(projectId, nextPage);
      res.json({ assistantMessage: output.assistantMessage, page: nextPage });
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        res.status(503).json({ error: "LLM temporarily unavailable", openUntilMs: error.openUntilMs });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  return router;
}
