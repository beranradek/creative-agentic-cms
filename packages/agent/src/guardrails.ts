import { type Page, type Section, type Component, type Asset } from "@cac/shared";
import { summarizePageDiff, type PageDiffSummary } from "./diff.js";

export type AgentEditPolicy = {
  allowAdd: boolean;
  allowReorder: boolean;
  allowDelete: boolean;
  allowLargeChanges: boolean;
};

export type DiffBudget = {
  maxSectionAdds: number;
  maxSectionDeletes: number;
  maxSectionEdits: number;
  maxComponentAdds: number;
  maxComponentDeletes: number;
  maxComponentMovesBetweenSections: number;
  maxComponentEdits: number;
  maxAssetAdds: number;
  maxAssetDeletes: number;
  maxAssetEdits: number;
  maxApproxJsonDeltaChars: number;
};

function normalizeMessage(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase();
}

export function getAgentEditPolicy(userMessage: string): AgentEditPolicy {
  const t = normalizeMessage(userMessage);

  const allowReorderRaw =
    /\b(reorder|re-order|order|move|swap|arrange|shuffle|structure|restructure|layout|redesign|position)\b/.test(t) ||
    /\b(presun|presunout|preusporadej|prehazej|prehod|serad|poradi|rozvrzeni|layout|redesign)\b/.test(t);

  const allowAddRaw =
    /\b(add|insert|create|append|include)\b.*\b(section|block|component|image|gallery|form|cta)\b/.test(t) ||
    /\b(new)\b.*\b(section|block|component)\b/.test(t) ||
    /\b(pridej|vloz|vytvor|dopln)\b.*\b(sekci|blok|komponentu|obrazek|galerii|formular|vyzvu)\b/.test(t) ||
    /\b(nova|novou|novy|nove)\b.*\b(sekce|blok|komponenta)\b/.test(t);

  const allowDelete =
    /\b(delete|remove|drop|erase)\b/.test(t) ||
    /\b(remove)\b.*\b(section|block|component|image|asset)\b/.test(t) ||
    /\b(smaz|smazat|odstran|odeber|vyhod)\b/.test(t);

  const allowLargeChanges =
    /\b(overhaul|rewrite|from scratch|complete redesign|big changes|major changes)\b/.test(t) ||
    /\b(kompletne|cela stranka|uprav vse|predelat celou|od zakladu|velke zmeny|zasadni zmeny)\b/.test(t);

  const allowAdd = allowAddRaw || allowLargeChanges;
  const allowReorder = allowReorderRaw || allowLargeChanges;
  return { allowAdd, allowReorder, allowDelete, allowLargeChanges };
}

function collectIds(page: Page): { sectionIds: Set<string>; componentIds: Set<string>; assetIds: Set<string> } {
  const sectionIds = new Set<string>();
  const componentIds = new Set<string>();
  const assetIds = new Set<string>();

  for (const section of page.sections) {
    sectionIds.add(section.id);
    for (const component of section.components) componentIds.add(component.id);
  }
  for (const asset of page.assets) assetIds.add(asset.id);

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

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isPrefix(prefix: readonly string[], full: readonly string[]): boolean {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== full[i]) return false;
  return true;
}

export function assertNoUnexpectedStructuralChanges(prev: Page, next: Page, userMessage: string): void {
  const policy = getAgentEditPolicy(userMessage);
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
  const sectionOrderOk = policy.allowAdd ? isPrefix(prevSectionOrder, nextSectionOrder) : arraysEqual(prevSectionOrder, nextSectionOrder);
  if (!sectionOrderOk) {
    throw new Error("Agent changed section order/structure without explicit permission. Ask explicitly to move/reorder sections.");
  }

  const nextSectionById = new Map(next.sections.map((s) => [s.id, s] as const));
  for (const prevSection of prev.sections) {
    const nextSection = nextSectionById.get(prevSection.id);
    if (!nextSection) continue;

    const prevCompOrder = prevSection.components.map((c) => c.id);
    const nextCompOrder = nextSection.components.map((c) => c.id);
    const compOrderOk = policy.allowAdd ? isPrefix(prevCompOrder, nextCompOrder) : arraysEqual(prevCompOrder, nextCompOrder);
    if (!compOrderOk) {
      throw new Error(
        `Agent changed component order/structure in section "${prevSection.id}" without explicit permission. Ask explicitly to move/reorder blocks.`
      );
    }
  }

  const prevComponentToSection = new Map<string, string>();
  for (const s of prev.sections) for (const c of s.components) prevComponentToSection.set(c.id, s.id);

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

export function assertDiffWithinBudget(summary: PageDiffSummary, budget: DiffBudget): void {
  if (summary.sections.added > budget.maxSectionAdds)
    throw new Error(`Agent change too large: added sections (${summary.sections.added}) exceeds budget (${budget.maxSectionAdds}).`);
  if (summary.sections.removed > budget.maxSectionDeletes)
    throw new Error(`Agent change too large: removed sections (${summary.sections.removed}) exceeds budget (${budget.maxSectionDeletes}).`);
  if (summary.sections.changed > budget.maxSectionEdits)
    throw new Error(`Agent change too large: edited sections (${summary.sections.changed}) exceeds budget (${budget.maxSectionEdits}).`);

  if (summary.components.added > budget.maxComponentAdds)
    throw new Error(`Agent change too large: added components (${summary.components.added}) exceeds budget (${budget.maxComponentAdds}).`);
  if (summary.components.removed > budget.maxComponentDeletes)
    throw new Error(`Agent change too large: removed components (${summary.components.removed}) exceeds budget (${budget.maxComponentDeletes}).`);
  if (summary.components.movedBetweenSections > budget.maxComponentMovesBetweenSections)
    throw new Error(
      `Agent change too large: moved components (${summary.components.movedBetweenSections}) exceeds budget (${budget.maxComponentMovesBetweenSections}).`
    );
  if (summary.components.changed > budget.maxComponentEdits)
    throw new Error(`Agent change too large: edited components (${summary.components.changed}) exceeds budget (${budget.maxComponentEdits}).`);

  if (summary.assets.added > budget.maxAssetAdds)
    throw new Error(`Agent change too large: added assets (${summary.assets.added}) exceeds budget (${budget.maxAssetAdds}).`);
  if (summary.assets.removed > budget.maxAssetDeletes)
    throw new Error(`Agent change too large: removed assets (${summary.assets.removed}) exceeds budget (${budget.maxAssetDeletes}).`);
  if (summary.assets.changed > budget.maxAssetEdits)
    throw new Error(`Agent change too large: edited assets (${summary.assets.changed}) exceeds budget (${budget.maxAssetEdits}).`);

  if (summary.approxJsonDeltaChars > budget.maxApproxJsonDeltaChars) {
    throw new Error(
      `Agent change too large: JSON delta (${summary.approxJsonDeltaChars}) exceeds budget (${budget.maxApproxJsonDeltaChars}).`
    );
  }
}

function collectComponentIds(sections: readonly Section[]): Set<string> {
  const ids = new Set<string>();
  for (const section of sections) for (const component of section.components) ids.add(component.id);
  return ids;
}

export function reconcilePageEdit(prev: Page, next: Page, userMessage: string): Page {
  const policy = getAgentEditPolicy(userMessage);

  let sections: Section[] = next.sections.map((section) => ({ ...section, components: [...section.components] }));
  const assets: Asset[] = [...next.assets];

  if (!policy.allowDelete) {
    const presentSectionIds = new Set(sections.map((s) => s.id));
    const presentComponentIds = collectComponentIds(sections);

    const sectionsById = new Map(sections.map((s) => [s.id, s] as const));
    for (const prevSection of prev.sections) {
      const keptSection = sectionsById.get(prevSection.id);
      if (!keptSection) continue;
      for (const prevComponent of prevSection.components) {
        if (presentComponentIds.has(prevComponent.id)) continue;
        keptSection.components.push(prevComponent as Component);
        presentComponentIds.add(prevComponent.id);
      }
    }

    for (const prevSection of prev.sections) {
      if (presentSectionIds.has(prevSection.id)) continue;
      const restoredComponents = prevSection.components.filter((c) => !presentComponentIds.has(c.id));
      const restoredSection: Section = { ...prevSection, components: [...restoredComponents] };
      sections.push(restoredSection);
      presentSectionIds.add(prevSection.id);
      for (const c of restoredComponents) presentComponentIds.add(c.id);
    }

    const presentAssetIds = new Set(assets.map((a) => a.id));
    for (const prevAsset of prev.assets) {
      if (presentAssetIds.has(prevAsset.id)) continue;
      assets.push(prevAsset);
      presentAssetIds.add(prevAsset.id);
    }
  }

  if (!policy.allowReorder) {
    const sectionsById = new Map(sections.map((s) => [s.id, s] as const));
    const orderedExisting = prev.sections
      .map((s) => sectionsById.get(s.id))
      .filter((s): s is Section => s !== undefined);
    const prevSectionIdSet = new Set(prev.sections.map((s) => s.id));
    const newSections = sections.filter((s) => !prevSectionIdSet.has(s.id));
    sections = [...orderedExisting, ...newSections];

    const prevSectionsById = new Map(prev.sections.map((s) => [s.id, s] as const));
    sections = sections.map((section) => {
      const prevSection = prevSectionsById.get(section.id);
      if (!prevSection) return section;
      const compsById = new Map(section.components.map((c) => [c.id, c] as const));
      const orderedExistingComps = prevSection.components
        .map((c) => compsById.get(c.id))
        .filter((c): c is Component => c !== undefined);
      const prevCompIdSet = new Set(prevSection.components.map((c) => c.id));
      const newComps = section.components.filter((c) => !prevCompIdSet.has(c.id));
      return { ...section, components: [...orderedExistingComps, ...newComps] };
    });
  }

  return { ...next, sections, assets };
}

export function validateAgentEdit(
  prev: Page,
  next: Page,
  userMessage: string,
  options: { budget: DiffBudget }
): { summary: PageDiffSummary; policy: AgentEditPolicy } {
  const policy = getAgentEditPolicy(userMessage);
  if (!policy.allowDelete) assertNoImplicitDeletions(prev, next);
  assertNoUnexpectedStructuralChanges(prev, next, userMessage);

  const summary = summarizePageDiff(prev, next);
  if (!policy.allowLargeChanges) assertDiffWithinBudget(summary, options.budget);

  return { summary, policy };
}
