import { describe, expect, it } from "vitest";
import type { Page } from "@cac/shared";
import { assertNoImplicitDeletions, assertNoUnexpectedStructuralChanges } from "../src/guardrails.js";

function basePage(): Page {
  return {
    version: 1,
    metadata: { title: "Demo", lang: "en", description: "" },
    assets: [
      {
        id: "img_1",
        type: "image",
        filename: "a.png",
        mimeType: "image/png",
        alt: "A",
        width: 800,
        height: 600,
      },
    ],
    sections: [
      {
        id: "sec_1",
        label: "Hero",
        style: { background: null, padding: 40, maxWidth: 980 },
        components: [
          {
            id: "cmp_1",
            type: "hero",
            headline: "Hello",
            subheadline: "World",
            primaryCtaText: "Get started",
            primaryCtaHref: "#contact",
            backgroundImageAssetId: "img_1",
          },
        ],
      },
      {
        id: "sec_2",
        label: "Body",
        style: { background: null, padding: 40, maxWidth: 980 },
        components: [
          {
            id: "cmp_2",
            type: "rich_text",
            html: "<p>Text</p>",
          },
        ],
      },
    ],
  };
}

describe("guardrails", () => {
  it("allows simple content edits", () => {
    const prev = basePage();
    const next: Page = {
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === "sec_1"
          ? {
              ...s,
              components: s.components.map((c) =>
                c.id === "cmp_1" && c.type === "hero" ? { ...c, headline: "Hello there" } : c
              ),
            }
          : s
      ),
    };

    expect(() => assertNoImplicitDeletions(prev, next)).not.toThrow();
    expect(() => assertNoUnexpectedStructuralChanges(prev, next, "Change the headline.")).not.toThrow();
  });

  it("blocks implicit deletions", () => {
    const prev = basePage();
    const next: Page = { ...prev, sections: prev.sections.slice(0, 1) };
    expect(() => assertNoImplicitDeletions(prev, next)).toThrow(/removed existing content/i);
  });

  it("blocks reorder unless explicitly requested", () => {
    const prev = basePage();
    const next: Page = { ...prev, sections: [...prev.sections].reverse() };
    expect(() => assertNoUnexpectedStructuralChanges(prev, next, "Update the text.")).toThrow(/section order/i);
    expect(() => assertNoUnexpectedStructuralChanges(prev, next, "Reorder sections.")).not.toThrow();
  });

  it("blocks component moves between sections unless explicitly requested", () => {
    const prev = basePage();

    const movedCmp = prev.sections[1]?.components[0];
    if (!movedCmp) throw new Error("Test setup failed");

    const next: Page = {
      ...prev,
      sections: [
        {
          ...prev.sections[0],
          components: [...prev.sections[0].components, movedCmp],
        },
        {
          ...prev.sections[1],
          components: [],
        },
      ],
    };

    expect(() => assertNoUnexpectedStructuralChanges(prev, next, "Change the headline.")).toThrow(
      /(component order|moved component)/i
    );
    expect(() => assertNoUnexpectedStructuralChanges(prev, next, "Move the rich text to the hero section.")).not.toThrow();
  });

  it("blocks additions unless explicitly requested", () => {
    const prev = basePage();
    const next: Page = {
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === "sec_2"
          ? {
              ...s,
              components: [
                ...s.components,
                { id: "cmp_new", type: "rich_text", html: "<p>New</p>" },
              ],
            }
          : s
      ),
    };

    expect(() => assertNoUnexpectedStructuralChanges(prev, next, "Change the headline.")).toThrow(/added new content/i);
    expect(() => assertNoUnexpectedStructuralChanges(prev, next, "Add a new block with a short paragraph.")).not.toThrow();
  });
});
