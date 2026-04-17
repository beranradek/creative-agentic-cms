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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");

const config = loadConfig(process.env);
const dataDirAbs = path.resolve(projectRoot, config.DATA_DIR);

const store = new ProjectStore(dataDirAbs);
const app = express();

app.use(cors());
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
  await store.writePage(body.projectId, createDefaultPage());
  res.json({ ok: true });
});

app.get("/api/projects/:projectId/page", async (req, res) => {
  const projectId = ProjectIdSchema.parse(req.params.projectId);
  try {
    const page = await store.readPage(projectId);
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
      await store.writePage(projectId, page);
      res.json({ page });
      return;
    }
    throw error;
  }
});

app.put("/api/projects/:projectId/page", async (req, res) => {
  const projectId = ProjectIdSchema.parse(req.params.projectId);
  const parsed = PageSchema.parse(req.body);
  await store.writePage(projectId, parsed);
  res.json({ ok: true });
});

app.use("/api/projects/:projectId/assets", createAssetRouter({ store, projectIdSchema: ProjectIdSchema }));
app.use("/api/projects/:projectId/agent", createAgentRouter({ store, projectIdSchema: ProjectIdSchema }));
app.use("/api/projects/:projectId/export", createExportRouter({ store, projectIdSchema: ProjectIdSchema }));

app.use("/projects", express.static(dataDirAbs, { fallthrough: true }));

app.listen(config.PORT, () => {
  console.log(`[server] listening on http://localhost:${config.PORT}`);
});
