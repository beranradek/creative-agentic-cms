import { describe, expect, it } from "vitest";
import { PageSchema } from "./page-schema.js";

describe("PageSchema", () => {
  it("parses minimal page with defaults", () => {
    const parsed = PageSchema.parse({ version: 1 });
    expect(parsed.metadata.title).toBeTruthy();
    expect(parsed.sections).toEqual([]);
    expect(parsed.assets).toEqual([]);
  });

  it("fills section defaults (style + settings)", () => {
    const parsed = PageSchema.parse({
      version: 1,
      sections: [{ id: "sec_1" }],
    });
    expect(parsed.sections).toHaveLength(1);
    const section = parsed.sections[0]!;
    expect(section.label).toBeTruthy();
    expect(section.style.background).toBeNull();
    expect(section.style.padding).toBeNull();
    expect(section.style.maxWidth).toBeNull();
    expect(section.settings.visible).toBe(true);
    expect(section.settings.layout).toBe("stack");
    expect(section.settings.gap).toBeNull();
    expect(section.settings.gridColumns).toBeNull();
  });
});
