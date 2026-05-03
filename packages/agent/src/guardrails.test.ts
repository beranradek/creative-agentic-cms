import { describe, expect, it } from "vitest";
import { PageSchema, type Page } from "@cac/shared";
import { summarizePageDiff } from "./diff.js";
import {
  assertNoImplicitDeletions,
  assertNoUnexpectedStructuralChanges,
  reconcilePageEdit,
  validateAgentEdit,
  type DiffBudget,
} from "./guardrails.js";

function makeBasePage(): Page {
  return PageSchema.parse({
    version: 1,
    metadata: { title: "Demo", description: "", lang: "en" },
    assets: [
      { id: "img_1", type: "image", filename: "a.png", mimeType: "image/png", alt: "a" },
      { id: "img_2", type: "image", filename: "b.png", mimeType: "image/png", alt: "b" },
    ],
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
        { id: "img_3", type: "image", filename: "c.png", mimeType: "image/png", width: null, height: null, alt: "" },
      ],
    };
    const diff = summarizePageDiff(prev, next);
    expect(diff.assets.added).toBe(1);
    expect(diff.sections.added).toBe(0);
  });

  describe("reconcilePageEdit", () => {
    it("restores assets the LLM dropped when user did not request deletion", () => {
      const prev = makeBasePage();
      const next: Page = { ...prev, assets: [] };

      const reconciled = reconcilePageEdit(prev, next, "Update the page title");

      expect(reconciled.assets.map((a) => a.id).sort()).toEqual(["img_1", "img_2"]);
    });

    it("honors explicit delete instructions and does not restore dropped assets", () => {
      const prev = makeBasePage();
      const next: Page = { ...prev, assets: [] };

      const reconciled = reconcilePageEdit(prev, next, "Smaž všechny obrázky");

      expect(reconciled.assets).toEqual([]);
    });

    it("restores a missing section together with its components", () => {
      const prev = makeBasePage();
      const next: Page = { ...prev, sections: prev.sections.slice(0, 1) };

      const reconciled = reconcilePageEdit(prev, next, "Update the hero headline");

      expect(reconciled.sections.map((s) => s.id)).toEqual(["sec_1", "sec_2"]);
      const restoredSec2 = reconciled.sections.find((s) => s.id === "sec_2");
      expect(restoredSec2?.components.map((c) => c.id)).toEqual(["cmp_2"]);
    });

    it("restores a component dropped from a surviving section", () => {
      const prev = makeBasePage();
      const next: Page = {
        ...prev,
        sections: prev.sections.map((s) => (s.id === "sec_2" ? { ...s, components: [] } : s)),
      };

      const reconciled = reconcilePageEdit(prev, next, "Update the hero headline");

      const sec2 = reconciled.sections.find((s) => s.id === "sec_2");
      expect(sec2?.components.map((c) => c.id)).toEqual(["cmp_2"]);
    });

    it("restores section order when reorder was not requested", () => {
      const prev = makeBasePage();
      const next: Page = { ...prev, sections: [...prev.sections].reverse() };

      const reconciled = reconcilePageEdit(prev, next, "Update the hero headline");

      expect(reconciled.sections.map((s) => s.id)).toEqual(["sec_1", "sec_2"]);
    });

    it("preserves LLM reorder when user explicitly asked to reorder", () => {
      const prev = makeBasePage();
      const next: Page = { ...prev, sections: [...prev.sections].reverse() };

      const reconciled = reconcilePageEdit(prev, next, "Reorder the sections");

      expect(reconciled.sections.map((s) => s.id)).toEqual(["sec_2", "sec_1"]);
    });

    it("does not duplicate a component the LLM moved between sections", () => {
      const prev = makeBasePage();
      const [secHero, secText] = prev.sections;
      if (!secHero || !secText) throw new Error("base page invariant violated");
      const movedComponent = secHero.components[0];
      if (!movedComponent) throw new Error("base page invariant violated");
      const next: Page = {
        ...prev,
        sections: [
          { ...secHero, components: [] },
          { ...secText, components: [...secText.components, movedComponent] },
        ],
      };

      const reconciled = reconcilePageEdit(prev, next, "Move the hero into the text section");

      const componentIds = reconciled.sections.flatMap((s) => s.components.map((c) => c.id));
      expect(componentIds.filter((id) => id === "cmp_1")).toHaveLength(1);
    });

    it("preserves the LLM's edits to surviving content (does not revert field changes)", () => {
      const prev = makeBasePage();
      const next: Page = {
        ...prev,
        metadata: { ...prev.metadata, title: "New Title" },
        assets: [],
      };

      const reconciled = reconcilePageEdit(prev, next, "Update the page title");

      expect(reconciled.metadata.title).toBe("New Title");
      expect(reconciled.assets.map((a) => a.id).sort()).toEqual(["img_1", "img_2"]);
    });
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
