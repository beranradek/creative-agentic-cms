import { resolveTheme, resolvedThemeToCssVars, type Asset, type Component, type Page, type Section } from "@cac/shared";
import { sanitizeRichTextHtml } from "../sanitize/rich-text.js";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderBoxStyle(style: {
  blockAlign: "left" | "center" | "right" | null;
  textAlign: "left" | "center" | "right" | null;
  maxWidth: 480 | 720 | 980 | null;
  padding: number | null;
  backgroundColor: string | null;
  backgroundGradient?: { from: string | null; to: string | null; angle: number | null } | null;
}): string {
  const styles: string[] = [];

  if (style.maxWidth !== null) {
    styles.push(`max-width:${style.maxWidth}px;`);
    const align = style.blockAlign ?? "center";
    if (align === "center") styles.push("margin:0 auto;");
    if (align === "left") styles.push("margin:0 auto 0 0;");
    if (align === "right") styles.push("margin:0 0 0 auto;");
  }

  if (style.textAlign !== null) styles.push(`text-align:${escapeHtml(style.textAlign)};`);
  if (style.padding !== null) styles.push(`padding:${style.padding}px;`);
  const gradientFrom = style.backgroundGradient?.from ?? null;
  const gradientTo = style.backgroundGradient?.to ?? null;
  if (gradientFrom && gradientTo) {
    const angle = style.backgroundGradient?.angle ?? 135;
    styles.push(`background:linear-gradient(${angle}deg, ${escapeHtml(gradientFrom)}, ${escapeHtml(gradientTo)});`);
  } else if (style.backgroundColor !== null) {
    styles.push(`background-color:${escapeHtml(style.backgroundColor)};`);
  }

  return styles.join("");
}

function renderButtonJustify(textAlign: "left" | "center" | "right" | null): string {
  if (textAlign === "center") return "center";
  if (textAlign === "right") return "end";
  return "start";
}

function renderButtonStyle(style: {
  variant: "filled" | "outline" | null;
  bgColor: string | null;
  textColor: string | null;
  borderColor: string | null;
  radius: number | null;
}): string {
  const styles: string[] = [];
  const accent = "var(--site-accent)";

  if (style.radius !== null) styles.push(`border-radius:${style.radius}px;`);

  if (style.variant === "outline") {
    styles.push("background:transparent;");
    styles.push(`color:${escapeHtml(style.textColor ?? accent)};`);
    styles.push(`border-color:${escapeHtml(style.borderColor ?? accent)};`);
    styles.push("border-style:solid;border-width:1px;");
  } else {
    if (style.bgColor !== null) styles.push(`background:${escapeHtml(style.bgColor)};`);
    if (style.textColor !== null) styles.push(`color:${escapeHtml(style.textColor)};`);
    if (style.borderColor !== null) styles.push(`border-color:${escapeHtml(style.borderColor)};`);
  }

  return styles.join("");
}

function renderComponent(component: Component, assetsById: Map<string, Asset>): string {
  if (component.type === "hero") {
    const bgAsset =
      component.backgroundImageAssetId && component.backgroundImageAssetId.length
        ? assetsById.get(component.backgroundImageAssetId)
        : null;
    const styles: string[] = [];
    if (bgAsset && bgAsset.type === "image") {
      styles.push(
        `background-image: radial-gradient(900px 380px at 15% 15%, rgba(37,99,235,0.10), transparent 62%), radial-gradient(900px 380px at 70% 20%, rgba(6,182,212,0.08), transparent 62%), linear-gradient(180deg, rgba(255,255,255,0.86), rgba(255,255,255,0.92)), url(assets/${escapeHtml(bgAsset.filename)}); background-size: auto, auto, cover, cover; background-position: 0 0, 0 0, center, center; background-repeat: no-repeat, no-repeat, no-repeat, no-repeat;`
      );
    }
    const boxStyle = renderBoxStyle(component.style);
    if (boxStyle) styles.push(boxStyle);
    const styleAttr = styles.length ? ` style="${styles.join("")}"` : "";
    const ctaStyle = renderButtonStyle(component.ctaStyle);
    const ctaStyleAttr = ctaStyle ? ` style="${ctaStyle}"` : "";
    return `
      <div class="hero"${styleAttr}>
        <h1>${escapeHtml(component.headline)}</h1>
        <p>${escapeHtml(component.subheadline)}</p>
        <a class="cta" href="${escapeHtml(component.primaryCtaHref)}"${ctaStyleAttr}>${escapeHtml(component.primaryCtaText)}</a>
      </div>
    `;
  }

  if (component.type === "rich_text") {
    const style = renderBoxStyle(component.style);
    const styleAttr = style ? ` style="${style}"` : "";
    const safe = sanitizeRichTextHtml(component.html);
    return `<div class="richText"${styleAttr}>${safe}</div>`;
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
    if (component.style.focalX !== null || component.style.focalY !== null) {
      const x = component.style.focalX ?? 50;
      const y = component.style.focalY ?? 50;
      imgStyles.push(`object-position:${x}% ${y}%;`);
    }
    const imgStyleAttr = imgStyles.length ? ` style="${imgStyles.join("")}"` : "";

    return `
      <div class="imageBlock"${figureStyleAttr}>
        <img src="assets/${escapeHtml(filename)}" alt="${escapeHtml(alt)}"${imgStyleAttr} />
        ${component.caption ? `<div class="imageCaption">${escapeHtml(component.caption)}</div>` : ""}
      </div>
    `;
  }

  if (component.type === "contact_form") {
    const boxStyle = renderBoxStyle(component.style);
    const styleAttr = boxStyle ? ` style="${boxStyle}"` : "";
    const justify = renderButtonJustify(component.style.textAlign);
    const submitStyle = renderButtonStyle(component.submitStyle);
    return `
      <div class="contactForm" id="contact"${styleAttr}>
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
          <button class="btn btnPrimary" type="submit" style="justify-self:${justify};${submitStyle}">${escapeHtml(component.submitLabel)}</button>
        </form>
      </div>
    `;
  }

  return "";
}

function renderSection(section: Section, assetsById: Map<string, Asset>): string {
  if (!section.settings.visible) return "";

  const styles: string[] = [];
  const sectionGradientFrom = section.style.backgroundGradient?.from ?? null;
  const sectionGradientTo = section.style.backgroundGradient?.to ?? null;
  if (sectionGradientFrom && sectionGradientTo) {
    const angle = section.style.backgroundGradient?.angle ?? 135;
    styles.push(`background:linear-gradient(${angle}deg, ${escapeHtml(sectionGradientFrom)}, ${escapeHtml(sectionGradientTo)});`);
  } else if (section.style.background) {
    styles.push(`background:${escapeHtml(section.style.background)};`);
  }
  if (section.style.padding !== null) styles.push(`padding:${section.style.padding}px;`);
  if (section.style.maxWidth !== null) styles.push(`max-width:${section.style.maxWidth}px;margin:0 auto;`);
  if ((sectionGradientFrom && sectionGradientTo) || section.style.background || section.style.padding !== null) styles.push("border-radius:18px;");

  const styleAttr = styles.length ? ` style="${styles.join("")}"` : "";

  const gap = section.settings.gap ?? 12;
  const layout = section.settings.layout;
  const gridColumns = section.settings.gridColumns ?? 2;

  const innerStyles: string[] = [];
  innerStyles.push(`gap:${gap}px;`);
  if (layout === "grid") {
    innerStyles.push("display:grid;");
    innerStyles.push(`grid-template-columns:repeat(${gridColumns},minmax(0,1fr));`);
    innerStyles.push("align-items:start;");
  } else {
    innerStyles.push("display:flex;flex-direction:column;");
  }
  const innerStyleAttr = innerStyles.length ? ` style="${innerStyles.join("")}"` : "";

  const inner = section.components.map((c) => renderComponent(c, assetsById)).join("\n");
  return `<section class="section"${styleAttr}>
<div class="sectionInner"${innerStyleAttr}>
${inner}
</div>
</section>`;
}

export function renderPageHtml(page: Page): { html: string; css: string } {
  const resolvedTheme = resolveTheme(page.theme);
  const cssVars = resolvedThemeToCssVars(resolvedTheme);
  const cssVarBlock = Object.entries(cssVars)
    .map(([k, v]) => `${k}:${v};`)
    .join(" ");

  const css = `
    :root { color-scheme: light; ${cssVarBlock} --bg:var(--site-bg); --panel:#ffffff; --text:var(--site-text); --muted:var(--site-muted); --line:rgba(15,23,42,0.10); --accent:var(--site-accent); }
    html,body { height:100%; }
    body { margin:0; font-family: var(--site-font-family); font-size: var(--site-font-size); line-height: var(--site-line-height); background: radial-gradient(1200px 600px at 15% 10%, rgba(37,99,235,0.10), transparent 58%), radial-gradient(900px 500px at 70% 20%, rgba(6,182,212,0.08), transparent 58%), var(--bg); color: var(--text); }
    .container { max-width: none; margin: 0 auto; padding: var(--site-space-4) var(--site-space-2); display:flex; flex-direction:column; gap: var(--site-space-3); }
    .section { width: 100%; max-width: 980px; margin: 0 auto; display:flex; flex-direction:column; gap: var(--site-space-2); background: rgba(255,255,255,0.96); border: 1px solid rgba(15,23,42,0.08); border-radius: var(--site-radius); padding: var(--site-space-3); box-shadow: 0 10px 26px rgba(15,23,42,0.06); }
    .sectionInner { display:flex; flex-direction:column; gap: var(--site-space-2); }
    .hero { border-radius: var(--site-radius); padding: var(--site-space-4); border: 1px solid rgba(15,23,42,0.08); background: radial-gradient(900px 380px at 15% 15%, rgba(37,99,235,0.10), transparent 62%), radial-gradient(900px 380px at 70% 20%, rgba(6,182,212,0.08), transparent 62%), rgba(255,255,255,0.96); }
    .hero h1 { margin:0; font-size: var(--site-h1-size); line-height: 1.05; letter-spacing:-0.02em; }
    .hero p { margin: 12px 0 0 0; color: rgba(51,65,85,0.92); max-width: 60ch; line-height: 1.45; }
    .cta { display:inline-flex; margin-top: var(--site-space-3); padding: 10px 14px; border-radius: 999px; border: 1px solid rgba(15,23,42,0.12); background: var(--site-accent); color: #ffffff; text-decoration:none; font-weight: 800; }
    .richText { border-radius: calc(var(--site-radius) - 4px); border: 1px solid rgba(15,23,42,0.10); padding: var(--site-space-3); background: rgba(255,255,255,0.98); }
    .imageBlock { border-radius: calc(var(--site-radius) - 4px); border: 1px solid rgba(15,23,42,0.10); padding: var(--site-space-3); background: rgba(255,255,255,0.98); }
    .imageBlock img { max-width: 100%; border-radius: 12px; display:block; }
    .imageCaption { margin-top: 8px; color: var(--muted); font-size: 12px; }
    .field { display:grid; gap: 6px; }
    .field label { font-size: 12px; color: var(--muted); }
    .field input, .field textarea { width: 100%; box-sizing:border-box; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(15,23,42,0.10); background: rgba(255,255,255,0.98); color: var(--text); }
    .btn { appearance:none; border: 1px solid rgba(15,23,42,0.10); background: #ffffff; color: var(--text); border-radius: 10px; padding: 10px 12px; cursor:pointer; font-weight: 700; box-shadow: 0 1px 0 rgba(15,23,42,0.04); }
    .btn:hover { border-color: rgba(37,99,235,0.35); background: rgba(248,250,252,0.95); }
    .btnPrimary { border-color: rgba(37,99,235,0.55); background: rgba(37,99,235,0.92); color: #ffffff; }
    .btnPrimary:hover { border-color: rgba(37,99,235,0.70); background: rgba(37,99,235,0.98); color: #ffffff; }
    .contactForm { border-radius: calc(var(--site-radius) - 4px); border: 1px solid rgba(15,23,42,0.10); padding: var(--site-space-3); background: rgba(255,255,255,0.98); }
    .contactForm h3 { margin: 0 0 12px 0; font-size: var(--site-h3-size); }
    .contactForm form { display:grid; gap: 10px; }
    .contactForm button { justify-self:start; }
  `.trim();

  const assetsById = new Map(page.assets.map((a) => [a.id, a]));

  const body = page.sections.map((s) => renderSection(s, assetsById)).join("\n");

  let ogImage:
    | null
    | {
        filename: string;
        alt: string;
        width: number | null;
        height: number | null;
      } = null;
  try {
    let ogImageAssetId: string | null = null;

    for (const section of page.sections) {
      for (const c of section.components) {
        if (c.type === "hero" && c.backgroundImageAssetId) {
          ogImageAssetId = c.backgroundImageAssetId;
          break;
        }
      }
      if (ogImageAssetId) break;
    }

    if (!ogImageAssetId) {
      for (const section of page.sections) {
        for (const c of section.components) {
          if (c.type === "image") {
            ogImageAssetId = c.assetId;
            break;
          }
        }
        if (ogImageAssetId) break;
      }
    }

    if (!ogImageAssetId) {
      const firstImage = page.assets.find((a) => a.type === "image");
      ogImageAssetId = firstImage?.type === "image" ? firstImage.id : null;
    }

    const asset = ogImageAssetId ? assetsById.get(ogImageAssetId) : null;
    if (asset && asset.type === "image") {
      ogImage = {
        filename: asset.filename,
        alt: asset.alt,
        width: asset.width,
        height: asset.height,
      };
    }
  } catch {
    ogImage = null;
  }

  const socialMeta: string[] = [];
  socialMeta.push(`<meta property="og:type" content="website" />`);
  socialMeta.push(`<meta property="og:title" content="${escapeHtml(page.metadata.title)}" />`);
  socialMeta.push(`<meta property="og:description" content="${escapeHtml(page.metadata.description)}" />`);
  if (ogImage) {
    socialMeta.push(`<meta property="og:image" content="assets/${escapeHtml(ogImage.filename)}" />`);
    if (ogImage.width !== null) socialMeta.push(`<meta property="og:image:width" content="${ogImage.width}" />`);
    if (ogImage.height !== null) socialMeta.push(`<meta property="og:image:height" content="${ogImage.height}" />`);
    if (ogImage.alt) socialMeta.push(`<meta property="og:image:alt" content="${escapeHtml(ogImage.alt)}" />`);
  }
  socialMeta.push(`<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}" />`);
  socialMeta.push(`<meta name="twitter:title" content="${escapeHtml(page.metadata.title)}" />`);
  socialMeta.push(`<meta name="twitter:description" content="${escapeHtml(page.metadata.description)}" />`);
  if (ogImage) socialMeta.push(`<meta name="twitter:image" content="assets/${escapeHtml(ogImage.filename)}" />`);

  const html = `<!doctype html>
<html lang="${escapeHtml(page.metadata.lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.metadata.title)}</title>
    <meta name="description" content="${escapeHtml(page.metadata.description)}" />
    ${socialMeta.join("\n    ")}
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
