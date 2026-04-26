import { type Page, type Section } from "@cac/shared";

export type AgentProposalStep =
  | { id: "page:settings"; title: string }
  | { id: "page:assets"; title: string }
  | { id: "sections:reorder"; title: string }
  | { id: `section:add:${string}`; title: string; sectionId: string }
  | { id: `section:update:${string}`; title: string; sectionId: string }
  | { id: `section:remove:${string}`; title: string; sectionId: string };

export function computeAgentProposalSteps(basePage: Page, proposedPage: Page): AgentProposalStep[] {
  const steps: AgentProposalStep[] = [];

  const settingsChanged =
    JSON.stringify(basePage.metadata) !== JSON.stringify(proposedPage.metadata) ||
    JSON.stringify(basePage.theme) !== JSON.stringify(proposedPage.theme);
  if (settingsChanged) {
    steps.push({ id: "page:settings", title: "Update page metadata + theme" });
  }

  const assetsChanged = JSON.stringify(basePage.assets) !== JSON.stringify(proposedPage.assets);
  if (assetsChanged) {
    steps.push({ id: "page:assets", title: `Update assets (${proposedPage.assets.length})` });
  }

  const baseSectionIds = basePage.sections.map((s) => s.id);
  const proposedSectionIds = proposedPage.sections.map((s) => s.id);
  if (baseSectionIds.join("|") !== proposedSectionIds.join("|")) {
    steps.push({ id: "sections:reorder", title: "Reorder sections" });
  }

  const baseById = new Map(basePage.sections.map((s) => [s.id, s] as const));
  const proposedById = new Map(proposedPage.sections.map((s) => [s.id, s] as const));

  for (const section of proposedPage.sections) {
    const base = baseById.get(section.id);
    if (!base) {
      steps.push({
        id: `section:add:${section.id}`,
        sectionId: section.id,
        title: `Add section: ${section.label || section.id}`,
      });
      continue;
    }
    if (JSON.stringify(base) !== JSON.stringify(section)) {
      steps.push({
        id: `section:update:${section.id}`,
        sectionId: section.id,
        title: `Update section: ${section.label || section.id}`,
      });
    }
  }

  for (const section of basePage.sections) {
    if (!proposedById.has(section.id)) {
      steps.push({
        id: `section:remove:${section.id}`,
        sectionId: section.id,
        title: `Remove section: ${section.label || section.id}`,
      });
    }
  }

  return steps;
}

export function buildPartialAgentProposalPage(basePage: Page, fullProposedPage: Page, stepIds: Set<string>): Page {
  let next: Page = basePage;

  if (stepIds.has("page:settings")) {
    next = { ...next, metadata: fullProposedPage.metadata, theme: fullProposedPage.theme };
  }
  if (stepIds.has("page:assets")) {
    next = { ...next, assets: fullProposedPage.assets };
  }

  const proposedById = new Map(fullProposedPage.sections.map((s) => [s.id, s] as const));
  const baseById = new Map(basePage.sections.map((s) => [s.id, s] as const));
  const proposedIdsSet = new Set(fullProposedPage.sections.map((s) => s.id));

  const addSelected = new Set(
    [...stepIds]
      .filter((id): id is `section:add:${string}` => id.startsWith("section:add:"))
      .map((id) => id.slice("section:add:".length))
      .filter(Boolean)
  );
  const updateSelected = new Set(
    [...stepIds]
      .filter((id): id is `section:update:${string}` => id.startsWith("section:update:"))
      .map((id) => id.slice("section:update:".length))
      .filter(Boolean)
  );
  const removeSelected = new Set(
    [...stepIds]
      .filter((id): id is `section:remove:${string}` => id.startsWith("section:remove:"))
      .map((id) => id.slice("section:remove:".length))
      .filter(Boolean)
  );

  const wantsTargetOrder = stepIds.has("sections:reorder") || addSelected.size > 0;
  const nextSections: Section[] = [];

  if (wantsTargetOrder) {
    for (const proposed of fullProposedPage.sections) {
      const base = baseById.get(proposed.id) ?? null;
      if (base) {
        nextSections.push(updateSelected.has(proposed.id) ? proposed : base);
        continue;
      }
      if (addSelected.has(proposed.id)) {
        nextSections.push(proposed);
      }
    }

    for (const base of basePage.sections) {
      if (proposedIdsSet.has(base.id)) continue;
      if (removeSelected.has(base.id)) continue;
      nextSections.push(base);
    }
  } else {
    for (const base of basePage.sections) {
      const proposed = proposedById.get(base.id) ?? null;
      if (!proposed) {
        if (removeSelected.has(base.id)) continue;
        nextSections.push(base);
        continue;
      }
      nextSections.push(updateSelected.has(base.id) ? proposed : base);
    }
  }

  next = { ...next, sections: nextSections };
  return next;
}
