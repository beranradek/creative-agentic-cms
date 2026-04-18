import type { Page, Section, Component, Asset } from "@cac/shared";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderComponent(component: Component, assetsById: Map<string, Asset>): string {
  if (component.type === "hero") {
    const bgAsset =
      component.backgroundImageAssetId && component.backgroundImageAssetId.length
        ? assetsById.get(component.backgroundImageAssetId)
        : null;
    const style =
      bgAsset && bgAsset.type === "image"
        ? ` style="background-image: radial-gradient(900px 380px at 15% 15%, rgba(124,92,255,0.35), transparent 60%), radial-gradient(900px 380px at 70% 20%, rgba(34,211,238,0.2), transparent 60%), linear-gradient(180deg, rgba(0,0,0,0.60), rgba(0,0,0,0.20)), url(assets/${escapeHtml(bgAsset.filename)}); background-size: auto, auto, cover, cover; background-position: 0 0, 0 0, center, center; background-repeat: no-repeat, no-repeat, no-repeat, no-repeat;"`
        : "";
    return `
      <div class="hero"${style}>
        <h1>${escapeHtml(component.headline)}</h1>
        <p>${escapeHtml(component.subheadline)}</p>
        <a class="cta" href="${escapeHtml(component.primaryCtaHref)}">${escapeHtml(component.primaryCtaText)}</a>
      </div>
    `;
  }

  if (component.type === "rich_text") {
    return `<div class="richText">${component.html}</div>`;
  }

  if (component.type === "image") {
    const asset = assetsById.get(component.assetId);
    if (!asset || asset.type !== "image") return "";
    const filename = asset.filename;
    const alt = asset.alt;
    return `
      <figure class="imageBlock">
        <img src="assets/${escapeHtml(filename)}" alt="${escapeHtml(alt)}" />
        ${component.caption ? `<figcaption>${escapeHtml(component.caption)}</figcaption>` : ""}
      </figure>
    `;
  }

  if (component.type === "contact_form") {
    return `
      <div class="contactForm" id="contact">
        <h2>${escapeHtml(component.headline)}</h2>
        <form method="post" action="#">
          <label>
            <span>Name</span>
            <input name="name" />
          </label>
          <label>
            <span>Email</span>
            <input name="email" />
          </label>
          <label>
            <span>Message</span>
            <textarea name="message" rows="5"></textarea>
          </label>
          <button type="submit">${escapeHtml(component.submitLabel)}</button>
        </form>
      </div>
    `;
  }

  return "";
}

function renderSection(section: Section, assetsById: Map<string, Asset>): string {
  const styles: string[] = [];
  if (section.style.background) styles.push(`background:${escapeHtml(section.style.background)};`);
  if (section.style.padding !== null) styles.push(`padding:${section.style.padding}px;`);
  if (section.style.maxWidth !== null) styles.push(`max-width:${section.style.maxWidth}px;margin:0 auto;`);
  if (section.style.background || section.style.padding !== null) styles.push("border-radius:18px;");

  const styleAttr = styles.length ? ` style="${styles.join("")}"` : "";

  const inner = section.components.map((c) => renderComponent(c, assetsById)).join("\n");
  return `<section class="section"${styleAttr}>
${inner}
</section>`;
}

export function renderPageHtml(page: Page): { html: string; css: string } {
  const css = `
    :root { color-scheme: light; --bg:#0b0d12; --text:#e8eefc; --muted:#a7b3d6; --line:rgba(255,255,255,0.12); --accent:#7c5cff; }
    html,body { height:100%; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; background: radial-gradient(1200px 600px at 15% 10%, rgba(124,92,255,0.35), transparent 55%), radial-gradient(900px 500px at 70% 20%, rgba(34,211,238,0.22), transparent 55%), var(--bg); color: var(--text); }
    .container { max-width: none; margin: 0 auto; padding: 32px 16px; display:flex; flex-direction:column; gap: 18px; }
    .section { width: 100%; max-width: 980px; margin: 0 auto; display:flex; flex-direction:column; gap: 12px; }
    .hero { border-radius: 18px; padding: 32px; border: 1px solid var(--line); background: radial-gradient(900px 380px at 15% 15%, rgba(124,92,255,0.35), transparent 60%), radial-gradient(900px 380px at 70% 20%, rgba(34,211,238,0.2), transparent 60%), rgba(0,0,0,0.22); }
    .hero h1 { margin:0; font-size: 44px; line-height: 1.05; letter-spacing:-0.02em; }
    .hero p { margin: 12px 0 0 0; color: rgba(232,238,252,0.9); max-width: 60ch; line-height: 1.45; }
    .cta { display:inline-flex; margin-top: 18px; padding: 10px 14px; border-radius: 999px; border: 1px solid rgba(124,92,255,0.6); background: rgba(124,92,255,0.2); color: var(--text); text-decoration:none; font-weight: 800; }
    .richText { border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); padding: 18px; background: rgba(0,0,0,0.18); }
    .imageBlock { margin:0; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); padding: 18px; background: rgba(0,0,0,0.18); }
    .imageBlock img { max-width: 100%; border-radius: 12px; display:block; }
    .imageBlock figcaption { margin-top: 8px; color: var(--muted); font-size: 12px; }
    .contactForm { border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); padding: 18px; background: rgba(0,0,0,0.18); }
    .contactForm form { display:grid; gap: 10px; }
    .contactForm label { display:grid; gap: 6px; }
    .contactForm span { font-size: 12px; color: var(--muted); }
    .contactForm input, .contactForm textarea { width: 100%; box-sizing:border-box; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.25); color: var(--text); }
    .contactForm button { justify-self:start; appearance:none; border: 1px solid rgba(124,92,255,0.55); background: rgba(124,92,255,0.18); color: var(--text); border-radius: 10px; padding: 10px 12px; cursor:pointer; font-weight: 800; }
  `.trim();

  const assetsById = new Map(page.assets.map((a) => [a.id, a]));

  const body = page.sections.map((s) => renderSection(s, assetsById)).join("\n");

  const html = `<!doctype html>
<html lang="${escapeHtml(page.metadata.lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.metadata.title)}</title>
    <meta name="description" content="${escapeHtml(page.metadata.description)}" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="container">
      ${body}
    </main>
  </body>
</html>
`;

  return { html, css };
}
