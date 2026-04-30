import { describe, expect, it } from "vitest";
import { PageSchema } from "@cac/shared";
import { renderPageHtml } from "./render-page.js";

describe("renderPageHtml", () => {
  it("renders basic Open Graph + Twitter metadata (prefers hero background image)", () => {
    const page = PageSchema.parse({
      version: 1,
      metadata: { title: "My Page", description: "Desc", lang: "en" },
      assets: [{ id: "a1", type: "image", filename: "hero.png", mimeType: "image/png", width: 1200, height: 630, alt: "Hero" }],
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
              backgroundImageAssetId: "a1",
            },
          ],
        },
      ],
    });

    const { html } = renderPageHtml(page);
    expect(html).toContain('property="og:type" content="website"');
    expect(html).toContain('property="og:title" content="My Page"');
    expect(html).toContain('property="og:description" content="Desc"');
    expect(html).toContain('property="og:image" content="assets/hero.png"');
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toContain('property="og:image:alt" content="Hero"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="twitter:image" content="assets/hero.png"');
  });

  it("includes canonical + og:url when baseUrl is provided (and injects analytics HTML)", () => {
    const page = PageSchema.parse({
      version: 1,
      metadata: { title: "t", description: "d", lang: "en" },
      assets: [],
      sections: [
        {
          id: "s1",
          label: "s",
          settings: { visible: true, layout: "stack", gap: null, gridColumns: null },
          style: {},
          components: [{ id: "c1", type: "hero", headline: "Hello", subheadline: "World" }],
        },
      ],
    });

    const { html } = renderPageHtml(page, {
      baseUrl: "https://example.com/site/",
      analyticsHtml: '<script id="analytics">console.log("x")</script>',
    });
    expect(html).toContain('<link rel="canonical" href="https://example.com/site/" />');
    expect(html).toContain('property="og:url" content="https://example.com/site/"');
    expect(html).toContain('<script id="analytics">console.log("x")</script>');
  });

  it("renders contact form submit config (disabled/netlify/custom)", () => {
    const basePage = PageSchema.parse({
      version: 1,
      metadata: { title: "t", description: "d", lang: "en" },
      assets: [],
      sections: [
        {
          id: "s1",
          label: "s",
          settings: { visible: true, layout: "stack", gap: null, gridColumns: null },
          style: {},
          components: [{ id: "c1", type: "contact_form", headline: "Contact", submitLabel: "Send" }],
        },
      ],
    });

    const disabled = renderPageHtml(basePage).html;
    expect(disabled).toContain('onsubmit="return false;"');

    const netlify = renderPageHtml(basePage, { contactForm: { mode: "netlify", actionUrl: null, netlifyFormName: "contact", successRedirectUrl: "/thanks" } })
      .html;
    expect(netlify).toContain('data-netlify="true"');
    expect(netlify).toContain('name="contact"');
    expect(netlify).toContain('action="/thanks"');
    expect(netlify).toContain('name="form-name" value="contact"');

    const custom = renderPageHtml(basePage, { contactForm: { mode: "custom", actionUrl: "https://example.com/submit", netlifyFormName: null, successRedirectUrl: null } })
      .html;
    expect(custom).toContain('action="https://example.com/submit"');
    expect(custom).not.toContain('onsubmit="return false;"');
  });

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

  it("renders divider components", () => {
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
          components: [{ id: "c1", type: "divider", style: { thickness: 4, color: "#ff0000", opacity: 0.8 } }],
        },
      ],
    });

    const { html } = renderPageHtml(page);
    expect(html).toContain('class="divider"');
    expect(html).toContain("height:4px");
    expect(html).toContain("background:#ff0000");
    expect(html).toContain("opacity:0.8");
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
              html: `<p onclick="alert(1)">Hello</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><b>Bold</b><i>It</i><div>Line</div>`,
            },
          ],
        },
      ],
    });

    const { html } = renderPageHtml(page);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick=");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>It</em>");
    expect(html).toContain("<p>Line</p>");
  });
});
