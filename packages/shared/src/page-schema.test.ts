import { describe, expect, it } from "vitest";
import { PageSchema } from "./page-schema.js";

describe("PageSchema", () => {
  it("parses minimal page with defaults", () => {
    const parsed = PageSchema.parse({ version: 1 });
    expect(parsed.metadata.title).toBeTruthy();
    expect(parsed.theme.preset).toBeNull();
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

  it("parses divider components with defaults", () => {
    const parsed = PageSchema.parse({
      version: 1,
      sections: [{ id: "sec_1", components: [{ id: "cmp_1", type: "divider" }] }],
    });
    const c = parsed.sections[0]!.components[0]!;
    expect(c.type).toBe("divider");
    if (c.type !== "divider") throw new Error("Expected divider");
    expect(c.style.thickness).toBeNull();
    expect(c.style.color).toBeNull();
    expect(c.style.maxWidth).toBeNull();
    expect(c.style.marginY).toBeNull();
    expect(c.style.opacity).toBeNull();
  });

  it("rejects unsafe asset filenames", () => {
    expect(() =>
      PageSchema.parse({
        version: 1,
        assets: [{ id: "img_1", type: "image", filename: "../img_1.png", mimeType: "image/png" }],
      })
    ).toThrow();
  });
});
