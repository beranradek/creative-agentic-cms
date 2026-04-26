import { describe, expect, it } from "vitest";
import { PageSchema } from "@cac/shared";
import { buildPartialAgentProposalPage, computeAgentProposalSteps } from "./proposal-steps.js";

describe("agent proposal steps", () => {
  it("detects page settings changes (metadata/theme)", () => {
    const base = PageSchema.parse({ version: 1 });
    const proposed = PageSchema.parse({ version: 1, metadata: { title: "New title" } });

    const steps = computeAgentProposalSteps(base, proposed);
    expect(steps.some((s) => s.id === "page:settings")).toBe(true);
  });

  it("detects assets changes", () => {
    const base = PageSchema.parse({ version: 1 });
    const proposed = PageSchema.parse({
      version: 1,
      assets: [{ id: "img_1", type: "image", filename: "a.png", mimeType: "image/png" }],
    });

    const steps = computeAgentProposalSteps(base, proposed);
    expect(steps.some((s) => s.id === "page:assets")).toBe(true);
  });

  it("detects section reorder + updates", () => {
    const base = PageSchema.parse({
      version: 1,
      sections: [
        { id: "s1", label: "One" },
        { id: "s2", label: "Two" },
      ],
    });
    const proposed = PageSchema.parse({
      version: 1,
      sections: [
        { id: "s2", label: "Two" },
        { id: "s1", label: "One (edited)" },
      ],
    });

    const steps = computeAgentProposalSteps(base, proposed);
    expect(steps.some((s) => s.id === "sections:reorder")).toBe(true);
    expect(steps.some((s) => s.id === "section:update:s1")).toBe(true);
  });

  it("builds a partial proposal by applying selected steps only", () => {
    const base = PageSchema.parse({
      version: 1,
      metadata: { title: "Base" },
      sections: [{ id: "s1", label: "One" }],
    });
    const full = PageSchema.parse({
      version: 1,
      metadata: { title: "Full" },
      sections: [{ id: "s1", label: "One (edited)" }],
    });

    const partial = buildPartialAgentProposalPage(base, full, new Set(["section:update:s1"]));
    expect(partial.metadata.title).toBe("Base");
    expect(partial.sections[0]?.label).toBe("One (edited)");
  });
});

