import { access, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Asset } from "@cac/shared";
import { renderPlaceholderSvg } from "./placeholder-svg.js";

export interface StagedPlaceholderFile {
  tmpPathAbs: string;
  finalPathAbs: string;
  svg: string;
}

async function fileExists(pathAbs: string): Promise<boolean> {
  try {
    await access(pathAbs);
    return true;
  } catch {
    return false;
  }
}

function assertSafeAssetFilename(filename: string): void {
  if (!filename) throw new Error("Invalid asset filename: empty");
  if (filename !== path.basename(filename)) throw new Error(`Invalid asset filename: "${filename}"`);
  if (filename.includes("..")) throw new Error(`Invalid asset filename: "${filename}"`);
}

export async function stageMissingSvgPlaceholderAssets(assetsDirAbs: string, assets: Asset[]): Promise<StagedPlaceholderFile[]> {
  const staged: StagedPlaceholderFile[] = [];

  for (const asset of assets) {
    if (asset.type !== "image") continue;
    assertSafeAssetFilename(asset.filename);

    if (asset.mimeType !== "image/svg+xml") continue;
    const expectedFilename = `${asset.id}.svg`;
    if (asset.filename !== expectedFilename) {
      throw new Error(`SVG placeholder filename must be "${expectedFilename}" (got "${asset.filename}")`);
    }

    const finalPathAbs = path.join(assetsDirAbs, asset.filename);
    if (await fileExists(finalPathAbs)) continue;

    const svg = renderPlaceholderSvg({
      text: asset.alt?.trim() || "Placeholder",
      ...(typeof asset.width === "number" ? { width: asset.width } : {}),
      ...(typeof asset.height === "number" ? { height: asset.height } : {}),
    });

    const tmpPathAbs = path.join(assetsDirAbs, `${asset.id}.${crypto.randomUUID()}.tmp.svg`);
    await writeFile(tmpPathAbs, svg, "utf8");
    staged.push({ tmpPathAbs, finalPathAbs, svg });
  }

  return staged;
}

export async function cleanupStagedPlaceholderFiles(staged: StagedPlaceholderFile[]): Promise<void> {
  await Promise.all(
    staged.map(async (f) => {
      try {
        await rm(f.tmpPathAbs, { force: true });
      } catch {
        // ignore cleanup failures
      }
    })
  );
}

export async function finalizeStagedPlaceholderFiles(staged: StagedPlaceholderFile[]): Promise<void> {
  for (const f of staged) {
    try {
      if (await fileExists(f.finalPathAbs)) {
        await rm(f.tmpPathAbs, { force: true });
        continue;
      }
      await rename(f.tmpPathAbs, f.finalPathAbs);
    } catch {
      // Fallback: best-effort write to final path and remove temp.
      try {
        if (!(await fileExists(f.finalPathAbs))) {
          await writeFile(f.finalPathAbs, f.svg, "utf8");
        }
      } finally {
        try {
          await rm(f.tmpPathAbs, { force: true });
        } catch {
          // ignore
        }
      }
    }
  }
}

