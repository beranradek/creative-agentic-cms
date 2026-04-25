import express from "express";
import { z, type ZodType } from "zod";
import type { ProjectStore } from "../project-store.js";
import { ExportConfigSchema } from "../export-config.js";

interface CreateExportConfigRouterOptions {
  store: ProjectStore;
  projectIdSchema: ZodType<string>;
}

export function createExportConfigRouter(options: CreateExportConfigRouterOptions): express.Router {
  const { store, projectIdSchema } = options;
  const router = express.Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const config = await store.readExportConfig(projectId);
    res.json({ ok: true, config });
  });

  router.put("/", async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const body = z.unknown().parse(req.body);
    const config = await store.writeExportConfig(projectId, body);
    res.json({ ok: true, config: ExportConfigSchema.parse(config) });
  });

  return router;
}

