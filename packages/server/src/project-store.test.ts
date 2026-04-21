import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PageSchema } from "@cac/shared";
import { createDefaultPage } from "./default-page.js";
import { ProjectStore } from "./project-store.js";

describe("ProjectStore ETag + conflict handling", () => {
  it("writes and reads with ETag", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cac-store-"));
    try {
      const store = new ProjectStore(tmpDir);
      const projectId = "p1";

      const initial = createDefaultPage();
      const etag1 = await store.writePageWithEtag(projectId, initial);
      const read1 = await store.readPageWithEtag(projectId);
      expect(read1.etag).toBe(etag1);
      expect(read1.page).toEqual(PageSchema.parse(initial));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects conflict when ETag mismatches", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cac-store-"));
    try {
      const store = new ProjectStore(tmpDir);
      const projectId = "p2";

      const initial = createDefaultPage();
      const etag1 = await store.writePageWithEtag(projectId, initial);

      const updated = PageSchema.parse({
        ...initial,
        metadata: { ...initial.metadata, title: "Changed" },
      });
      const ok = await store.writePageIfMatch(projectId, updated, etag1);
      expect(ok.ok).toBe(true);
      if (!ok.ok) throw new Error("unreachable");

      const conflict = await store.writePageIfMatch(projectId, initial, etag1);
      expect(conflict.ok).toBe(false);
      if (conflict.ok) throw new Error("unreachable");
      expect(conflict.page?.metadata.title).toBe("Changed");
      expect(conflict.etag).toBeTruthy();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent If-Match writes (one wins, one conflicts)", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cac-store-"));
    try {
      const store = new ProjectStore(tmpDir);
      const projectId = "p3";

      const initial = createDefaultPage();
      const etag1 = await store.writePageWithEtag(projectId, initial);

      const updatedA = PageSchema.parse({
        ...initial,
        metadata: { ...initial.metadata, title: "A" },
      });
      const updatedB = PageSchema.parse({
        ...initial,
        metadata: { ...initial.metadata, title: "B" },
      });

      const [r1, r2] = await Promise.all([
        store.writePageIfMatch(projectId, updatedA, etag1),
        store.writePageIfMatch(projectId, updatedB, etag1),
      ]);

      const okCount = [r1, r2].filter((r) => r.ok).length;
      expect(okCount).toBe(1);

      const final = await store.readPage(projectId);
      expect(["A", "B"]).toContain(final.metadata.title);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
