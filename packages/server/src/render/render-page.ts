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
        ? ` style="background-image: radial-gradient(900px 380px at 15% 15%, rgba(37,99,235,0.10), transparent 62%), radial-gradient(900px 380px at 70% 20%, rgba(6,182,212,0.08), transparent 62%), linear-gradient(180deg, rgba(255,255,255,0.86), rgba(255,255,255,0.92)), url(assets/${escapeHtml(bgAsset.filename)}); background-size: auto, auto, cover, cover; background-position: 0 0, 0 0, center, center; background-repeat: no-repeat, no-repeat, no-repeat, no-repeat;"`
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

    const figureStyles: string[] = [];
    if (component.style.maxWidth !== null) figureStyles.push(`max-width:${component.style.maxWidth}px;`);
    const align = component.style.align ?? "center";
    if (align === "center") figureStyles.push("margin:0 auto;");
    if (align === "left") figureStyles.push("margin:0 auto 0 0;");
    if (align === "right") figureStyles.push("margin:0 0 0 auto;");
    const figureStyleAttr = figureStyles.length ? ` style="${figureStyles.join("")}"` : "";

    const imgStyles: string[] = [];
    if (component.style.radius !== null) imgStyles.push(`border-radius:${component.style.radius}px;`);
    if (component.style.fit !== null) imgStyles.push(`object-fit:${escapeHtml(component.style.fit)};`);
    const imgStyleAttr = imgStyles.length ? ` style="${imgStyles.join("")}"` : "";

    return `
      <div class="imageBlock"${figureStyleAttr}>
        <img src="assets/${escapeHtml(filename)}" alt="${escapeHtml(alt)}"${imgStyleAttr} />
        ${component.caption ? `<div class="imageCaption">${escapeHtml(component.caption)}</div>` : ""}
      </div>
    `;
  }

  if (component.type === "contact_form") {
    return `
      <div class="contactForm" id="contact">
        <h3>${escapeHtml(component.headline)}</h3>
        <form method="post" action="#" onsubmit="return false;">
          <div class="field">
            <label>Name</label>
            <input name="name" />
          </div>
          <div class="field">
            <label>Email</label>
            <input name="email" />
          </div>
          <div class="field">
            <label>Message</label>
            <textarea name="message" rows="4"></textarea>
          </div>
          <button class="btn btnPrimary" type="submit">${escapeHtml(component.submitLabel)}</button>
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
    :root { color-scheme: light; --bg:#f4f6fb; --panel:#ffffff; --text:#0f172a; --muted:#64748b; --line:rgba(15,23,42,0.10); --accent:#2563eb; }
    html,body { height:100%; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; background: radial-gradient(1200px 600px at 15% 10%, rgba(37,99,235,0.10), transparent 58%), radial-gradient(900px 500px at 70% 20%, rgba(6,182,212,0.08), transparent 58%), var(--bg); color: var(--text); }
    .container { max-width: none; margin: 0 auto; padding: 32px 16px; display:flex; flex-direction:column; gap: 18px; }
    .section { width: 100%; max-width: 980px; margin: 0 auto; display:flex; flex-direction:column; gap: 12px; background: rgba(255,255,255,0.96); border: 1px solid rgba(15,23,42,0.08); border-radius: 18px; padding: 18px; box-shadow: 0 10px 26px rgba(15,23,42,0.06); }
    .hero { border-radius: 18px; padding: 32px; border: 1px solid rgba(15,23,42,0.08); background: radial-gradient(900px 380px at 15% 15%, rgba(37,99,235,0.10), transparent 62%), radial-gradient(900px 380px at 70% 20%, rgba(6,182,212,0.08), transparent 62%), rgba(255,255,255,0.96); }
    .hero h1 { margin:0; font-size: 44px; line-height: 1.05; letter-spacing:-0.02em; }
    .hero p { margin: 12px 0 0 0; color: rgba(51,65,85,0.92); max-width: 60ch; line-height: 1.45; }
    .cta { display:inline-flex; margin-top: 18px; padding: 10px 14px; border-radius: 999px; border: 1px solid rgba(15,23,42,0.12); background: #111827; color: #ffffff; text-decoration:none; font-weight: 800; }
    .richText { border-radius: 14px; border: 1px solid rgba(15,23,42,0.10); padding: 18px; background: rgba(255,255,255,0.98); }
    .imageBlock { border-radius: 14px; border: 1px solid rgba(15,23,42,0.10); padding: 18px; background: rgba(255,255,255,0.98); }
    .imageBlock img { max-width: 100%; border-radius: 12px; display:block; }
    .imageCaption { margin-top: 8px; color: var(--muted); font-size: 12px; }
    .field { display:grid; gap: 6px; }
    .field label { font-size: 12px; color: var(--muted); }
    .field input, .field textarea { width: 100%; box-sizing:border-box; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(15,23,42,0.10); background: rgba(255,255,255,0.98); color: var(--text); }
    .btn { appearance:none; border: 1px solid rgba(15,23,42,0.10); background: #ffffff; color: var(--text); border-radius: 10px; padding: 10px 12px; cursor:pointer; font-weight: 700; box-shadow: 0 1px 0 rgba(15,23,42,0.04); }
    .btn:hover { border-color: rgba(37,99,235,0.35); background: rgba(248,250,252,0.95); }
    .btnPrimary { border-color: rgba(37,99,235,0.55); background: rgba(37,99,235,0.92); color: #ffffff; }
    .btnPrimary:hover { border-color: rgba(37,99,235,0.70); background: rgba(37,99,235,0.98); color: #ffffff; }
    .contactForm { border-radius: 14px; border: 1px solid rgba(15,23,42,0.10); padding: 18px; background: rgba(255,255,255,0.98); }
    .contactForm h3 { margin: 0 0 12px 0; }
    .contactForm form { display:grid; gap: 10px; }
    .contactForm button { justify-self:start; }
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
