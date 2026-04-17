import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { z, type ZodType } from "zod";
import imageSize from "image-size";
import { ImageAssetSchema } from "@cac/shared";
import type { ProjectStore } from "../project-store.js";

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

  return router;
}
