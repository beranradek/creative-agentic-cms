import { describe, expect, it } from "vitest";
import { PageSchema } from "@cac/shared";
import { renderPageHtml } from "./render-page.js";

describe("renderPageHtml", () => {
  it("renders image focal point via object-position", () => {
    const page = PageSchema.parse({
      version: 1,
      metadata: { title: "t", description: "", lang: "en" },
      assets: [{ id: "a1", type: "image", filename: "a.png", mimeType: "image/png", width: 100, height: 100, alt: "a" }],
      sections: [
        {
          id: "s1",
          label: "s",
          settings: { visible: true, layout: "stack", gap: null, gridColumns: null },
          style: {},
          components: [
            {
              id: "c1",
              type: "image",
              assetId: "a1",
              caption: "",
              style: { fit: "cover", focalX: 10, focalY: 80 },
            },
          ],
        },
      ],
    });

    const { html } = renderPageHtml(page);
    expect(html).toContain("object-position:10% 80%");
  });

  it("omits object-position when focal point is unset", () => {
    const page = PageSchema.parse({
      version: 1,
      metadata: { title: "t", description: "", lang: "en" },
      assets: [{ id: "a1", type: "image", filename: "a.png", mimeType: "image/png", width: 100, height: 100, alt: "a" }],
      sections: [
        {
          id: "s1",
          label: "s",
          settings: { visible: true, layout: "stack", gap: null, gridColumns: null },
          style: {},
          components: [
            {
              id: "c1",
              type: "image",
              assetId: "a1",
              caption: "",
              style: { fit: "cover" },
            },
          ],
        },
      ],
    });

    const { html } = renderPageHtml(page);
    expect(html).not.toContain("object-position:");
  });

  it("applies component box styles (align/maxWidth/padding/background)", () => {
    const page = PageSchema.parse({
      version: 1,
      metadata: { title: "t", description: "", lang: "en" },
      assets: [],
      sections: [
        {
          id: "s1",
          label: "s",
          settings: { visible: true, layout: "stack", gap: null, gridColumns: null },
          style: {},
          components: [
            {
              id: "c1",
              type: "hero",
              headline: "Hello",
              subheadline: "World",
              style: { maxWidth: 480, blockAlign: "right", textAlign: "right", padding: 12, backgroundColor: "#ff0000" },
            },
            {
              id: "c2",
              type: "rich_text",
              html: "<p>Hi</p>",
              style: { maxWidth: 720, textAlign: "center", padding: 8, backgroundColor: "#00ff00" },
            },
            {
              id: "c3",
              type: "contact_form",
              headline: "Contact",
              submitLabel: "Send",
              style: { textAlign: "center" },
            },
          ],
        },
      ],
    });

    const { html } = renderPageHtml(page);
    expect(html).toContain("max-width:480px");
    expect(html).toContain("margin:0 0 0 auto");
    expect(html).toContain("text-align:right");
    expect(html).toContain("padding:12px");
    expect(html).toContain("background-color:#ff0000");

    expect(html).toContain("max-width:720px");
    expect(html).toContain("text-align:center");
    expect(html).toContain("background-color:#00ff00");

    expect(html).toContain("justify-self:center");
  });

  it("renders gradients and button inline styles", () => {
    const page = PageSchema.parse({
      version: 1,
      metadata: { title: "t", description: "", lang: "en" },
      assets: [],
      sections: [
        {
          id: "s1",
          label: "s",
          settings: { visible: true, layout: "stack", gap: null, gridColumns: null },
          style: { backgroundGradient: { from: "#111111", to: "#222222", angle: 90 } },
          components: [
            {
              id: "c1",
              type: "hero",
              headline: "Hello",
              subheadline: "World",
              ctaStyle: { variant: "outline", textColor: "#ff0000", borderColor: "#00ff00", radius: 18 },
              style: { backgroundGradient: { from: "#abcdef", to: "#123456", angle: 180 } },
            },
            {
              id: "c2",
              type: "contact_form",
              headline: "Contact",
              submitLabel: "Send",
              submitStyle: { bgColor: "#0000ff", textColor: "#ffffff", radius: 6 },
              style: {},
            },
          ],
        },
      ],
    });

    const { html } = renderPageHtml(page);
    expect(html).toContain("background:linear-gradient(90deg, #111111, #222222)");
    expect(html).toContain("background:linear-gradient(180deg, #abcdef, #123456)");
    expect(html).toContain('class="cta"');
    expect(html).toContain("background:transparent;");
    expect(html).toContain("border-radius:18px;");
    expect(html).toContain("color:#ff0000;");
    expect(html).toContain("border-color:#00ff00;");
    expect(html).toContain("background:#0000ff;");
    expect(html).toContain("border-radius:6px;");
  });

  it("sanitizes rich_text HTML (no scripts / handlers / javascript:)", () => {
    const page = PageSchema.parse({
      version: 1,
      metadata: { title: "t", description: "", lang: "en" },
      assets: [],
      sections: [
        {
          id: "s1",
          label: "s",
          settings: { visible: true, layout: "stack", gap: null, gridColumns: null },
          style: {},
          components: [
            {
              id: "c1",
              type: "rich_text",
              html: `<p onclick="alert(1)">Hello</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>`,
            },
          ],
        },
      ],
    });

    const { html } = renderPageHtml(page);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick=");
    expect(html).not.toContain("javascript:");
  });
});
