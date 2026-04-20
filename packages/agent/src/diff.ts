import { type Page, type Section, type Component, type Asset } from "@cac/shared";

export type PageDiffSummary = {
  sections: {
    added: number;
    removed: number;
    reordered: boolean;
    changed: number;
  };
  components: {
    added: number;
    removed: number;
    movedBetweenSections: number;
    reorderedWithinSections: number;
    changed: number;
  };
  assets: {
    added: number;
    removed: number;
    changed: number;
  };
  approxJsonDeltaChars: number;
};

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function jsonStableLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function serializeComparableSection(section: Section): unknown {
  return { label: section.label, style: section.style };
}

function serializeComparableAsset(asset: Asset): unknown {
  if (asset.type === "image") {
    return { id: asset.id, type: asset.type, filename: asset.filename, alt: asset.alt };
  }
  return asset;
}

function serializeComparableComponent(component: Component): unknown {
  return component;
}

export function summarizePageDiff(prev: Page, next: Page): PageDiffSummary {
  const prevSectionIds = prev.sections.map((s) => s.id);
  const nextSectionIds = next.sections.map((s) => s.id);
  const prevSectionSet = new Set(prevSectionIds);
  const nextSectionSet = new Set(nextSectionIds);

  const sectionAdded = nextSectionIds.filter((id) => !prevSectionSet.has(id)).length;
  const sectionRemoved = prevSectionIds.filter((id) => !nextSectionSet.has(id)).length;
  const sectionReordered = sectionAdded === 0 && sectionRemoved === 0 && !arraysEqual(prevSectionIds, nextSectionIds);

  const nextSectionById = new Map(next.sections.map((s) => [s.id, s] as const));
  let sectionChanged = 0;
  for (const prevSection of prev.sections) {
    const nextSection = nextSectionById.get(prevSection.id);
    if (!nextSection) continue;
    if (JSON.stringify(serializeComparableSection(prevSection)) !== JSON.stringify(serializeComparableSection(nextSection))) {
      sectionChanged += 1;
    }
  }

  const prevComponentToSection = new Map<string, string>();
  const prevComponentById = new Map<string, Component>();
  for (const s of prev.sections) {
    for (const c of s.components) {
      prevComponentToSection.set(c.id, s.id);
      prevComponentById.set(c.id, c);
    }
  }

  const nextComponentToSection = new Map<string, string>();
  const nextComponentById = new Map<string, Component>();
  for (const s of next.sections) {
    for (const c of s.components) {
      nextComponentToSection.set(c.id, s.id);
      nextComponentById.set(c.id, c);
    }
  }

  const componentAdded = [...nextComponentById.keys()].filter((id) => !prevComponentById.has(id)).length;
  const componentRemoved = [...prevComponentById.keys()].filter((id) => !nextComponentById.has(id)).length;

  let componentMovedBetweenSections = 0;
  let componentChanged = 0;
  for (const [id, prevComponent] of prevComponentById) {
    const nextComponent = nextComponentById.get(id);
    if (!nextComponent) continue;
    const prevSectionId = prevComponentToSection.get(id);
    const nextSectionId = nextComponentToSection.get(id);
    if (prevSectionId && nextSectionId && prevSectionId !== nextSectionId) componentMovedBetweenSections += 1;
    if (JSON.stringify(serializeComparableComponent(prevComponent)) !== JSON.stringify(serializeComparableComponent(nextComponent))) {
      componentChanged += 1;
    }
  }

  let componentReorderedWithinSections = 0;
  const prevSectionById = new Map(prev.sections.map((s) => [s.id, s] as const));
  for (const nextSection of next.sections) {
    const prevSection = prevSectionById.get(nextSection.id);
    if (!prevSection) continue;
    const prevIds = prevSection.components.map((c) => c.id);
    const nextIds = nextSection.components.map((c) => c.id);
    const nextIdSet = new Set(nextIds);
    const sameMembers = prevIds.length === nextIds.length && prevIds.every((id) => nextIdSet.has(id));
    if (sameMembers && !arraysEqual(prevIds, nextIds)) componentReorderedWithinSections += 1;
  }

  const prevAssetById = new Map(prev.assets.map((a) => [a.id, a] as const));
  const nextAssetById = new Map(next.assets.map((a) => [a.id, a] as const));
  const assetAdded = [...nextAssetById.keys()].filter((id) => !prevAssetById.has(id)).length;
  const assetRemoved = [...prevAssetById.keys()].filter((id) => !nextAssetById.has(id)).length;

  let assetChanged = 0;
  for (const [id, prevAsset] of prevAssetById) {
    const nextAsset = nextAssetById.get(id);
    if (!nextAsset) continue;
    if (JSON.stringify(serializeComparableAsset(prevAsset)) !== JSON.stringify(serializeComparableAsset(nextAsset))) assetChanged += 1;
  }

  const approxJsonDeltaChars = Math.abs(jsonStableLength(prev) - jsonStableLength(next));

  return {
    sections: { added: sectionAdded, removed: sectionRemoved, reordered: sectionReordered, changed: sectionChanged },
    components: {
      added: componentAdded,
      removed: componentRemoved,
      movedBetweenSections: componentMovedBetweenSections,
      reorderedWithinSections: componentReorderedWithinSections,
      changed: componentChanged,
    },
    assets: { added: assetAdded, removed: assetRemoved, changed: assetChanged },
    approxJsonDeltaChars,
  };
}
