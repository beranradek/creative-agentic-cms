import type { Page } from "@cac/shared";

type StructuralPolicy = {
  allowAdd: boolean;
  allowReorder: boolean;
};

function normalizeMessage(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase();
}

function getStructuralPolicy(userMessage: string): StructuralPolicy {
  const t = normalizeMessage(userMessage);

  const allowReorder =
    /\b(reorder|re-order|order|move|swap|arrange|shuffle|structure|restructure|layout|redesign|position)\b/.test(t) ||
    /\b(presun|presunout|preusporadej|prehazej|prehod|serad|poradi|rozvrzeni|layout)\b/.test(t);

  const allowAdd =
    /\b(add|insert|create|append|include)\b.*\b(section|block|component|image|gallery|form|cta)\b/.test(t) ||
    /\b(new)\b.*\b(section|block|component)\b/.test(t) ||
    /\b(pridej|vloz|vytvor|dopln)\b.*\b(sekci|blok|komponentu|obrazek|galerii|formular|vyzvu)\b/.test(t) ||
    /\b(nova|novou|novy|nove)\b.*\b(sekce|blok|komponenta)\b/.test(t);

  return { allowAdd, allowReorder };
}

function collectIds(page: Page) {
  const sectionIds = new Set<string>();
  const componentIds = new Set<string>();
  const assetIds = new Set<string>();

  for (const section of page.sections) {
    sectionIds.add(section.id);
    for (const component of section.components) {
      componentIds.add(component.id);
    }
  }

  for (const asset of page.assets) {
    assetIds.add(asset.id);
  }

  return { sectionIds, componentIds, assetIds };
}

export function assertNoImplicitDeletions(prev: Page, next: Page): void {
  const prevIds = collectIds(prev);
  const nextIds = collectIds(next);

  const removedSections = [...prevIds.sectionIds].filter((id) => !nextIds.sectionIds.has(id));
  const removedComponents = [...prevIds.componentIds].filter((id) => !nextIds.componentIds.has(id));
  const removedAssets = [...prevIds.assetIds].filter((id) => !nextIds.assetIds.has(id));

  if (removedSections.length || removedComponents.length || removedAssets.length) {
    throw new Error(
      `Agent removed existing content without explicit permission (sections: ${removedSections.length}, components: ${removedComponents.length}, assets: ${removedAssets.length}). Try again with an explicit delete instruction.`
    );
  }
}

function assertArrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function assertPrefix(prefix: readonly string[], full: readonly string[]): boolean {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== full[i]) return false;
  }
  return true;
}

export function assertNoUnexpectedStructuralChanges(prev: Page, next: Page, userMessage: string): void {
  const policy = getStructuralPolicy(userMessage);

  const prevIds = collectIds(prev);
  const nextIds = collectIds(next);

  if (!policy.allowAdd) {
    const addedSections = [...nextIds.sectionIds].filter((id) => !prevIds.sectionIds.has(id));
    const addedComponents = [...nextIds.componentIds].filter((id) => !prevIds.componentIds.has(id));
    const addedAssets = [...nextIds.assetIds].filter((id) => !prevIds.assetIds.has(id));

    if (addedSections.length || addedComponents.length || addedAssets.length) {
      throw new Error(
        `Agent added new content without explicit permission (sections: ${addedSections.length}, components: ${addedComponents.length}, assets: ${addedAssets.length}). Ask explicitly to add a new block/section/image.`
      );
    }
  }

  if (policy.allowReorder) return;

  const prevSectionOrder = prev.sections.map((s) => s.id);
  const nextSectionOrder = next.sections.map((s) => s.id);

  const sectionOrderOk = policy.allowAdd
    ? assertPrefix(prevSectionOrder, nextSectionOrder)
    : assertArrayEqual(prevSectionOrder, nextSectionOrder);

  if (!sectionOrderOk) {
    throw new Error("Agent changed section order/structure without explicit permission. Ask explicitly to move/reorder sections.");
  }

  const nextSectionById = new Map<string, Page["sections"][number]>(next.sections.map((s) => [s.id, s]));

  for (const prevSection of prev.sections) {
    const nextSection = nextSectionById.get(prevSection.id);
    if (!nextSection) continue;

    const prevCompOrder = prevSection.components.map((c) => c.id);
    const nextCompOrder = nextSection.components.map((c) => c.id);

    const compOrderOk = policy.allowAdd
      ? assertPrefix(prevCompOrder, nextCompOrder)
      : assertArrayEqual(prevCompOrder, nextCompOrder);

    if (!compOrderOk) {
      throw new Error(
        `Agent changed component order/structure in section "${prevSection.id}" without explicit permission. Ask explicitly to move/reorder blocks.`
      );
    }
  }

  const prevComponentToSection = new Map<string, string>();
  for (const s of prev.sections) {
    for (const c of s.components) prevComponentToSection.set(c.id, s.id);
  }

  for (const s of next.sections) {
    for (const c of s.components) {
      const prevSectionId = prevComponentToSection.get(c.id);
      if (prevSectionId && prevSectionId !== s.id) {
        throw new Error(
          `Agent moved component "${c.id}" from section "${prevSectionId}" to "${s.id}" without explicit permission. Ask explicitly to move blocks between sections.`
        );
      }
    }
  }
}

