import { describe, expect, it } from "vitest";
import { renderPlaceholderSvg } from "./placeholder-svg.js";

describe("renderPlaceholderSvg", () => {
  it("renders deterministic SVG with escaped text", () => {
    const svg = renderPlaceholderSvg({ text: `Hello & <world>`, width: 400, height: 300 });
    expect(svg).toContain(`<svg`);
    expect(svg).toContain(`width="400"`);
    expect(svg).toContain(`height="300"`);
    expect(svg).toContain(`Hello &amp; &lt;world&gt;`);
    expect(svg).toContain(`role="img"`);
  });

  it("clamps sizes to sane limits", () => {
    const svg = renderPlaceholderSvg({ text: "X", width: 10, height: 999999 });
    expect(svg).toContain(`width="64"`);
    expect(svg).toContain(`height="4096"`);
  });
});

