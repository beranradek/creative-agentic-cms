import path from "node:path";
import crypto from "node:crypto";
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
import { createPreviewRouter } from "./routes/preview.js";
import { createImagegenRouter } from "./routes/imagegen.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");

const config = loadConfig(process.env);
const dataDirAbs = path.resolve(projectRoot, config.DATA_DIR);
const apiSessionToken = config.API_SESSION_TOKEN ?? crypto.randomUUID();

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
const SESSION_CACHE_CONTROL = "no-store, private";

function getRequestOrigin(req: express.Request): string | null {
  const originHeader = req.header("origin");
  if (originHeader && originHeader.trim().length) return originHeader;

  const refererHeader = req.header("referer");
  if (!refererHeader || !refererHeader.trim().length) return null;
  try {
    return new URL(refererHeader).origin;
  } catch {
    return null;
  }
}

function isTrustedEditorOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (allowedOrigins.has("*") || allowedOrigins.has(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function requireEditorSession(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.header("authorization");
  if (header === `Bearer ${apiSessionToken}`) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized." });
}

function getValidatedProjectId(res: express.Response): string {
  return res.locals.projectId as string;
}

app.param("projectId", (req, res, next, rawProjectId) => {
  const parsed = ProjectIdSchema.safeParse(rawProjectId);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid projectId." });
    return;
  }
  req.params.projectId = parsed.data;
  res.locals.projectId = parsed.data;
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  res.setHeader("Cache-Control", SESSION_CACHE_CONTROL);
  if (!isTrustedEditorOrigin(getRequestOrigin(req))) {
    res.status(401).json({ error: "Editor session unavailable for this origin." });
    return;
  }

  res.json({ token: apiSessionToken });
});

app.get("/api/imagegen/available", (_req, res) => {
  res.json({ available: !!config.OPENAI_API_KEY });
});

app.get("/api/projects", requireEditorSession, async (_req, res) => {
  const projects = await store.listProjects();
  res.json({ projects });
});

app.post("/api/projects", requireEditorSession, async (req, res) => {
  const body = z.object({ projectId: ProjectIdSchema }).parse(req.body);
  await store.ensureProject(body.projectId);
  const etag = await store.writePageWithEtag(body.projectId, createDefaultPage());
  res.setHeader("ETag", etag);
  res.json({ ok: true });
});

app.get("/api/projects/:projectId/page", async (req, res, next) => {
  const projectId = getValidatedProjectId(res);
  res.locals.projectId = projectId;
  next();
}, requireEditorSession, async (req, res) => {
  const projectId = getValidatedProjectId(res);
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

app.put("/api/projects/:projectId/page", async (req, res, next) => {
  const projectId = getValidatedProjectId(res);
  res.locals.projectId = projectId;
  next();
}, requireEditorSession, async (req, res) => {
  const projectId = getValidatedProjectId(res);
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

app.use("/api/projects/:projectId/assets", requireEditorSession, createAssetRouter({ store, projectIdSchema: ProjectIdSchema }));
app.use("/api/projects/:projectId/agent", requireEditorSession, createAgentRouter({ store, projectIdSchema: ProjectIdSchema }));
app.use("/api/projects/:projectId/export", requireEditorSession, createExportRouter({ store, projectIdSchema: ProjectIdSchema }));
if (config.OPENAI_API_KEY) {
  app.use(
    "/api/projects/:projectId/imagegen",
    requireEditorSession,
    createImagegenRouter({ store, projectIdSchema: ProjectIdSchema, apiKey: config.OPENAI_API_KEY, model: config.IMAGEGEN_MODEL })
  );
}

app.use("/api/projects/:projectId/preview", requireEditorSession, createPreviewRouter({ store, projectIdSchema: ProjectIdSchema }));

app.use("/projects", (req, res, next) => {
  const normalizedPath = path.posix.normalize(`/${req.path}`);
  if (normalizedPath.endsWith("/page.json")) {
    res.status(404).end();
    return;
  }
  if (normalizedPath.includes("/.workspace/") && !normalizedPath.includes("/.workspace/screenshots/")) {
    res.status(404).end();
    return;
  }
  next();
});
app.use("/projects", express.static(dataDirAbs, { fallthrough: true }));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }

  console.error("[server] request failed", error);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(config.PORT, config.HOST, () => {
  console.log(`[server] listening on http://${config.HOST}:${config.PORT}`);
});
