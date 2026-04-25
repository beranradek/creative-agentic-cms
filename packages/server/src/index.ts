import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { PageSchema } from "@cac/shared";
import { loadConfig } from "./config.js";
import { createDefaultPage } from "./default-page.js";
import { ProjectStore } from "./project-store.js";
import { createAssetRouter } from "./routes/assets.js";
import { createAgentRouter } from "./routes/agent.js";
import { createExportRouter } from "./routes/export.js";
import { createExportConfigRouter } from "./routes/export-config.js";
import { createPreviewRouter } from "./routes/preview.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");

const config = loadConfig(process.env);
const dataDirAbs = path.resolve(projectRoot, config.DATA_DIR);

const store = new ProjectStore(dataDirAbs);
const app = express();

const allowedOrigins = new Set(
  config.CORS_ORIGINS.split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has("*")) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    exposedHeaders: ["ETag"],
  })
);
app.use(express.json({ limit: "5mb" }));

const ProjectIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);

app.get("/api/projects", async (_req, res) => {
  const projects = await store.listProjects();
  res.json({ projects });
});

app.post("/api/projects", async (req, res) => {
  const body = z.object({ projectId: ProjectIdSchema }).parse(req.body);
  await store.ensureProject(body.projectId);
  const etag = await store.writePageWithEtag(body.projectId, createDefaultPage());
  res.setHeader("ETag", etag);
  res.json({ ok: true });
});

app.get("/api/projects/:projectId/page", async (req, res) => {
  const projectId = ProjectIdSchema.parse(req.params.projectId);
  try {
    const { page, etag } = await store.readPageWithEtag(projectId);
    res.setHeader("ETag", etag);
    res.json({ page });
  } catch (error) {
    const isMissing =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT";
    if (isMissing) {
      await store.ensureProject(projectId);
      const page = createDefaultPage();
      const etag = await store.writePageWithEtag(projectId, page);
      res.setHeader("ETag", etag);
      res.json({ page });
      return;
    }
    throw error;
  }
});

app.put("/api/projects/:projectId/page", async (req, res) => {
  const projectId = ProjectIdSchema.parse(req.params.projectId);
  const force = z
    .enum(["1", "true"])
    .optional()
    .transform((v) => v === "1" || v === "true")
    .parse(req.query.force);
  const parsed = PageSchema.parse(req.body);

  const expectedEtag = z.string().min(1).optional().parse(req.header("if-match"));

  if (!force && expectedEtag) {
    const result = await store.writePageIfMatch(projectId, parsed, expectedEtag);
    if (!result.ok) {
      if (result.etag) res.setHeader("ETag", result.etag);
      res.status(409).json({ error: "conflict", page: result.page });
      return;
    }
    res.setHeader("ETag", result.etag);
    res.json({ ok: true });
    return;
  }

  const etag = await store.writePageWithEtag(projectId, parsed);
  res.setHeader("ETag", etag);
  res.json({ ok: true });
});

app.use("/api/projects/:projectId/assets", createAssetRouter({ store, projectIdSchema: ProjectIdSchema }));
app.use("/api/projects/:projectId/agent", createAgentRouter({ store, projectIdSchema: ProjectIdSchema }));
app.use("/api/projects/:projectId/export-config", createExportConfigRouter({ store, projectIdSchema: ProjectIdSchema }));
app.use("/api/projects/:projectId/export", createExportRouter({ store, projectIdSchema: ProjectIdSchema }));
app.use("/api/projects/:projectId/preview", createPreviewRouter({ store, projectIdSchema: ProjectIdSchema }));

app.use("/projects", express.static(dataDirAbs, { fallthrough: true }));

app.listen(config.PORT, config.HOST, () => {
  console.log(`[server] listening on http://${config.HOST}:${config.PORT}`);
});
