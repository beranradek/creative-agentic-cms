import { describe, expect, it } from "vitest";
import { PageSchema } from "./page-schema.js";

describe("PageSchema", () => {
  it("parses minimal page with defaults", () => {
    const parsed = PageSchema.parse({ version: 1 });
    expect(parsed.metadata.title).toBeTruthy();
    expect(parsed.sections).toEqual([]);
    expect(parsed.assets).toEqual([]);
  });
});

