import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { z, type ZodType } from "zod";
import imageSize from "image-size";
import { AssetIdSchema, ImageAssetSchema } from "@cac/shared";
import type { ProjectStore } from "../project-store.js";
import { renderPlaceholderSvg } from "../placeholder-svg.js";

interface CreateAssetRouterOptions {
  store: ProjectStore;
  projectIdSchema: ZodType<string>;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

const MimeToExt: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

function createAssetId(): string {
  return `img_${crypto.randomUUID()}`;
}

export function createAssetRouter(options: CreateAssetRouterOptions): express.Router {
  const { store, projectIdSchema } = options;
  const router = express.Router({ mergeParams: true });

  router.post("/images/placeholder", express.json({ limit: "64kb" }), async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const text = z.string().min(1).max(120).parse((req.body as { text?: unknown } | undefined)?.text);
    const width = z.number().int().positive().max(4096).optional().parse((req.body as { width?: unknown } | undefined)?.width);
    const height = z.number().int().positive().max(4096).optional().parse((req.body as { height?: unknown } | undefined)?.height);
    const alt = z.string().max(240).optional().parse((req.body as { alt?: unknown } | undefined)?.alt);

    const assetId = createAssetId();
    const filename = `${assetId}.svg`;

    await store.ensureProject(projectId);
    const assetsDir = store.getAssetsDir(projectId);
    await mkdir(assetsDir, { recursive: true });

    const svg = renderPlaceholderSvg({
      text,
      ...(typeof width === "number" ? { width } : {}),
      ...(typeof height === "number" ? { height } : {}),
    });
    const targetPath = path.join(assetsDir, filename);
    await writeFile(targetPath, svg, "utf8");

    const asset = ImageAssetSchema.parse({
      id: assetId,
      type: "image",
      filename,
      mimeType: "image/svg+xml",
      width: width ?? null,
      height: height ?? null,
      alt: alt ?? text,
    });

    res.json({ asset });
  });

  router.post("/images", upload.single("file"), async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const alt = z.string().optional().parse(req.body?.alt);

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }

    const mimeType = z.string().min(1).parse(file.mimetype);
    const ext = MimeToExt[mimeType];
    if (!ext) {
      res.status(415).json({ error: `Unsupported image type: ${mimeType}` });
      return;
    }

    const assetId = createAssetId();
    const filename = `${assetId}${ext}`;

    await store.ensureProject(projectId);
    const assetsDir = store.getAssetsDir(projectId);
    await mkdir(assetsDir, { recursive: true });

    const targetPath = path.join(assetsDir, filename);
    await writeFile(targetPath, file.buffer);

    const dimensions = imageSize(file.buffer);
    const asset = ImageAssetSchema.parse({
      id: assetId,
      type: "image",
      filename,
      mimeType,
      width: dimensions.width,
      height: dimensions.height,
      alt: alt ?? "",
    });

    res.json({ asset });
  });

  router.post("/images/:assetId/replace", upload.single("file"), async (req, res) => {
    const projectId = projectIdSchema.parse((req.params as { projectId?: string }).projectId);
    const assetId = AssetIdSchema.parse((req.params as { assetId?: string }).assetId);
    const clientEtag = z.string().min(1).optional().parse(req.header("if-match"));

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }

    const mimeType = z.string().min(1).parse(file.mimetype);
    const ext = MimeToExt[mimeType];
    if (!ext) {
      res.status(415).json({ error: `Unsupported image type: ${mimeType}` });
      return;
    }

    await store.ensureProject(projectId);
    const assetsDir = store.getAssetsDir(projectId);
    await mkdir(assetsDir, { recursive: true });

    let pageWithEtag;
    try {
      pageWithEtag = await store.readPageWithEtag(projectId);
    } catch {
      res.status(404).json({ error: "Project page not found" });
      return;
    }
    const page = pageWithEtag.page;
    const expectedEtag = pageWithEtag.etag;

    if (clientEtag && clientEtag !== expectedEtag) {
      res.setHeader("ETag", expectedEtag);
      res.status(409).json({ error: "conflict", page });
      return;
    }

    const existingAsset = page.assets.find((a) => a.type === "image" && a.id === assetId);
    if (!existingAsset || existingAsset.type !== "image") {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const filename = `${assetId}${ext}`;
    const targetPath = path.join(assetsDir, filename);
    await writeFile(targetPath, file.buffer);

    const dimensions = imageSize(file.buffer);
    const updatedAsset = ImageAssetSchema.parse({
      ...existingAsset,
      filename,
      mimeType,
      width: dimensions.width ?? null,
      height: dimensions.height ?? null,
    });

    const nextPage = {
      ...page,
      assets: page.assets.map((a) => (a.type === "image" && a.id === assetId ? updatedAsset : a)),
    };
    const writeResult = await store.writePageIfMatch(projectId, nextPage, expectedEtag);
    if (!writeResult.ok) {
      if (filename !== existingAsset.filename) {
        try {
          await unlink(targetPath);
        } catch {
          // ignore rollback failures
        }
      }
      if (writeResult.etag) res.setHeader("ETag", writeResult.etag);
      res.status(409).json({ error: "conflict", page: writeResult.page });
      return;
    }
    res.setHeader("ETag", writeResult.etag);

    try {
      const files = await readdir(assetsDir);
      await Promise.all(
        files
          .filter((f) => f.startsWith(`${assetId}.`) && f !== filename)
          .map(async (f) => {
            try {
              await unlink(path.join(assetsDir, f));
            } catch {
              // ignore
            }
          })
      );
    } catch {
      // ignore cleanup failures
    }

    res.json({ ok: true, asset: updatedAsset, page: nextPage });
  });

  return router;
}
