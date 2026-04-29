function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clampInt(value: number, min: number, max: number): number {
  const v = Math.trunc(value);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

export function renderPlaceholderSvg(input: { text: string; width?: number; height?: number }): string {
  const width = clampInt(input.width ?? 1200, 64, 4096);
  const height = clampInt(input.height ?? 800, 64, 4096);

  const raw = input.text.trim().replace(/\s+/g, " ");
  const text = escapeXml(raw || "Placeholder");

  const fontSize = clampInt(Math.round(Math.min(width, height) * 0.06), 16, 72);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${text}">`,
    `  <defs>`,
    `    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`,
    `      <stop offset="0" stop-color="#0ea5e9" stop-opacity="0.18" />`,
    `      <stop offset="1" stop-color="#a855f7" stop-opacity="0.18" />`,
    `    </linearGradient>`,
    `    <radialGradient id="glow" cx="30%" cy="30%" r="75%">`,
    `      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55" />`,
    `      <stop offset="1" stop-color="#ffffff" stop-opacity="0" />`,
    `    </radialGradient>`,
    `  </defs>`,
    `  <rect x="0" y="0" width="${width}" height="${height}" fill="#0b1220" />`,
    `  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)" />`,
    `  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#glow)" />`,
    `  <rect x="18" y="18" width="${width - 36}" height="${height - 36}" rx="22" fill="none" stroke="#ffffff" stroke-opacity="0.18" />`,
    `  <g fill="#ffffff" fill-opacity="0.92" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial" text-anchor="middle">`,
    `    <text x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" font-size="${fontSize}" font-weight="650" dominant-baseline="middle">${text}</text>`,
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

