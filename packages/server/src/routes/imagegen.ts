import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import imageSize from "image-size";
import { z, type ZodType } from "zod";
import { ImageAssetSchema } from "@cac/shared";
import type { ProjectStore } from "../project-store.js";
import { generateImage } from "../imagegen/image-gen-agent.js";
import { JobManager } from "../imagegen/job-manager.js";

interface CreateImagegenRouterOptions {
  store: ProjectStore;
  projectIdSchema: ZodType<string>;
  apiKey: string;
  model: string;
}

const GenerateBodySchema = z.object({
  prompt: z.string().min(1).max(1000),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]),
  quality: z.enum(["low", "medium", "high"]),
});

export function createImagegenRouter(options: CreateImagegenRouterOptions): express.Router {
  const { store, projectIdSchema, apiKey, model } = options;
  const router = express.Router({ mergeParams: true });
  const jobManager = new JobManager();
  jobManager.startCleanup();

  router.post("/generate", async (req, res) => {
    projectIdSchema.parse((req.params as { projectId?: string }).projectId);

    const ip = req.ip ?? "unknown";
    if (!jobManager.checkRateLimit(ip)) {
      res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
      return;
    }

    let body: z.infer<typeof GenerateBodySchema>;
    try {
      body = GenerateBodySchema.parse(req.body);
    } catch {
      res.status(400).json({ error: "Invalid request body." });
      return;
    }

    const job = jobManager.createJob();

    generateImage(body.prompt, body.size, body.quality, model, apiKey)
      .then((tempImage) => {
        const tempImageId = crypto.randomUUID();
        jobManager.storeTempImage(tempImageId, tempImage);
        jobManager.updateJob(job.id, { status: "completed", tempImageId });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Image generation failed, try again.";
        jobManager.updateJob(job.id, { status: "error", error: message });
      });

    res.json({ jobId: job.id });
  });

  router.get("/job/:jobId", (req, res) => {
    const jobId = z.string().min(1).parse((req.params as { jobId?: string }).jobId);
    const job = jobManager.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.json({ jobId: job.id, status: job.status, tempImageId: job.tempImageId, error: job.error });
  });

  router.get("/temp/:tempImageId", (req, res) => {
    const tempImageId = z.string().min(1).parse((req.params as { tempImageId?: string }).tempImageId);
    const img = jobManager.getTempImage(tempImageId);
    if (!img) {
      res.status(404).json({ error: "Temp image not found or expired." });
      return;
    }
    res.setHeader("Content-Type", img.mimeType);
    res.setHeader("Cache-Control", "no-store");
    res.send(img.buffer);
  });

  router.post("/save/:tempImageId", async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const tempImageId = z.string().min(1).parse((req.params as { tempImageId?: string }).tempImageId);
    const alt = z.string().optional().parse((req.body as { alt?: unknown }).alt);

    const img = jobManager.getTempImage(tempImageId);
    if (!img) {
      res.status(404).json({ error: "Temp image not found or expired." });
      return;
    }

    jobManager.deleteTempImage(tempImageId);

    await store.ensureProject(projectId);
    const assetsDir = store.getAssetsDir(projectId);
    await mkdir(assetsDir, { recursive: true });

    const assetId = `img_${crypto.randomUUID()}`;
    const filename = `${assetId}.png`;
    const targetPath = path.join(assetsDir, filename);
    await writeFile(targetPath, img.buffer);

    let width: number | null = null;
    let height: number | null = null;
    try {
      const dims = imageSize(img.buffer);
      width = dims.width ?? null;
      height = dims.height ?? null;
    } catch (_e) {
      width = null;
      height = null;
    }

    const asset = ImageAssetSchema.parse({
      id: assetId,
      type: "image",
      filename,
      mimeType: img.mimeType,
      width,
      height,
      alt: alt ?? "",
    });

    let pageWithEtag;
    try {
      pageWithEtag = await store.readPageWithEtag(projectId);
    } catch {
      res.status(404).json({ error: "Project not found." });
      return;
    }

    const nextPage = {
      ...pageWithEtag.page,
      assets: [...pageWithEtag.page.assets, asset],
    };
    await store.writePageIfMatch(projectId, nextPage, pageWithEtag.etag);

    res.json({ asset });
  });

  return router;
}
