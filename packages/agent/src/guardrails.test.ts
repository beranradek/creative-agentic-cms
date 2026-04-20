import { describe, expect, it } from "vitest";
import { PageSchema, type Page } from "@cac/shared";
import { summarizePageDiff } from "./diff.js";
import { assertNoImplicitDeletions, assertNoUnexpectedStructuralChanges, validateAgentEdit, type DiffBudget } from "./guardrails.js";

function makeBasePage(): Page {
  return PageSchema.parse({
    version: 1,
    metadata: { title: "Demo", description: "", lang: "en" },
    assets: [{ id: "img_1", type: "image", filename: "a.png", mimeType: "image/png", alt: "a" }],
    sections: [
      {
        id: "sec_1",
        label: "Hero",
        components: [{ id: "cmp_1", type: "hero", headline: "Hello", subheadline: "World" }],
      },
      {
        id: "sec_2",
        label: "Text",
        components: [{ id: "cmp_2", type: "rich_text", html: "<p>One</p>" }],
      },
    ],
  });
}

const tightBudget: DiffBudget = {
  maxSectionAdds: 0,
  maxSectionDeletes: 0,
  maxSectionEdits: 0,
  maxComponentAdds: 0,
  maxComponentDeletes: 0,
  maxComponentMovesBetweenSections: 0,
  maxComponentEdits: 0,
  maxAssetAdds: 0,
  maxAssetDeletes: 0,
  maxAssetEdits: 0,
  maxApproxJsonDeltaChars: 0,
};

describe("guardrails", () => {
  it("blocks implicit deletions", () => {
    const prev = makeBasePage();
    const next: Page = { ...prev, sections: prev.sections.slice(0, 1) };
    expect(() => assertNoImplicitDeletions(prev, next)).toThrow(/removed existing content/i);
  });

  it("blocks reorders unless requested", () => {
    const prev = makeBasePage();
    const next: Page = { ...prev, sections: [...prev.sections].reverse() };
    expect(() => assertNoUnexpectedStructuralChanges(prev, next, "Change the hero headline")).toThrow(/section order/i);
    expect(() => assertNoUnexpectedStructuralChanges(prev, next, "Please reorder sections")).not.toThrow();
  });

  it("summarizes diff counts", () => {
    const prev = makeBasePage();
    const next: Page = {
      ...prev,
      assets: [
        ...prev.assets,
        { id: "img_2", type: "image", filename: "b.png", mimeType: "image/png", width: null, height: null, alt: "" },
      ],
    };
    const diff = summarizePageDiff(prev, next);
    expect(diff.assets.added).toBe(1);
    expect(diff.sections.added).toBe(0);
  });

  it("enforces diff budget unless user asks for big changes", () => {
    const prev = makeBasePage();
    const next: Page = {
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === "sec_1"
          ? { ...s, components: s.components.map((c) => (c.type === "hero" ? { ...c, headline: "Updated" } : c)) }
          : s
      ),
    };

    expect(() => validateAgentEdit(prev, next, "Update the hero headline", { budget: tightBudget })).toThrow(/budget/i);
    expect(() => validateAgentEdit(prev, next, "Make big changes: complete redesign", { budget: tightBudget })).not.toThrow();
  });
});
