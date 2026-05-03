import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Asset } from "@cac/shared";
import {
  cleanupStagedPlaceholderFiles,
  finalizeStagedPlaceholderFiles,
  stageMissingSvgPlaceholderAssets,
} from "./placeholder-materialize.js";

describe("placeholder-materialize", () => {
  it("stages and finalizes missing svg placeholders", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cac-placeholders-"));
    try {
      const assets: Asset[] = [
        {
          id: "img_test_1",
          type: "image",
          filename: "img_test_1.svg",
          mimeType: "image/svg+xml",
          width: 800,
          height: 450,
          alt: "Hello",
        },
      ];

      const staged = await stageMissingSvgPlaceholderAssets(tmpDir, assets);
      expect(staged).toHaveLength(1);
      expect(staged[0]?.tmpPathAbs).toContain("tmp.svg");
      expect(staged[0]?.finalPathAbs).toBe(path.join(tmpDir, "img_test_1.svg"));

      await finalizeStagedPlaceholderFiles(staged);

      const svg = await readFile(path.join(tmpDir, "img_test_1.svg"), "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("Hello");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe filenames", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cac-placeholders-"));
    try {
      const assets: Asset[] = [
        {
          id: "img_test_2",
          type: "image",
          filename: "../img_test_2.svg",
          mimeType: "image/svg+xml",
          width: null,
          height: null,
          alt: "X",
        },
      ];

      await expect(stageMissingSvgPlaceholderAssets(tmpDir, assets)).rejects.toThrow(/Invalid asset filename/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("cleanup removes staged temp files", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cac-placeholders-"));
    try {
      const assets: Asset[] = [
        {
          id: "img_test_3",
          type: "image",
          filename: "img_test_3.svg",
          mimeType: "image/svg+xml",
          width: null,
          height: null,
          alt: "Temp",
        },
      ];

      const staged = await stageMissingSvgPlaceholderAssets(tmpDir, assets);
      expect(staged).toHaveLength(1);

      await cleanupStagedPlaceholderFiles(staged);
      // finalize should not throw even if tmp is gone
      await finalizeStagedPlaceholderFiles(staged);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

