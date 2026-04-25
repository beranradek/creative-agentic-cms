import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";
import {
  AssetSchema,
  COMPONENT_MAX_WIDTHS,
  BUTTON_VARIANTS,
  PageSchema,
  SECTION_GRID_COLUMNS,
  SECTION_LAYOUTS,
  SECTION_MAX_WIDTHS,
  THEME_PRESETS,
  TEXT_ALIGNS,
  resolveTheme,
  resolvedThemeToCssVars,
  type Asset,
  type Component,
  type Page,
  type Section,
} from "@cac/shared";
import { isSttSupported, startStt, stopStt } from "./stt.js";
import { useToast } from "./toast.js";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; editor: { page: Page; past: Page[]; future: Page[] } }
  | { kind: "error"; message: string };

type ImageEditorState =
  | {
      kind: "asset";
      assetId: string;
      replaceAllUsages: boolean;
    }
  | {
      kind: "component";
      assetId: string;
      sectionId: string;
      componentId: string;
      replaceAllUsages: boolean;
    };

type PaletteTab = "project" | "agent" | "add" | "assets";

const DEFAULT_PROJECT_ID = "demo";
const UNDO_LIMIT = 50;

type ComponentBoxStyle = {
  blockAlign: (typeof TEXT_ALIGNS)[number] | null;
  textAlign: (typeof TEXT_ALIGNS)[number] | null;
  maxWidth: (typeof COMPONENT_MAX_WIDTHS)[number] | null;
  padding: number | null;
  backgroundColor: string | null;
  backgroundGradient: {
    from: string | null;
    to: string | null;
    angle: number | null;
  } | null;
};

function computeBoxOuterStyle(style: ComponentBoxStyle): React.CSSProperties {
  const out: React.CSSProperties = {};
  if (style.maxWidth !== null) out.maxWidth = style.maxWidth;
  if (style.maxWidth !== null) {
    const align = style.blockAlign ?? "center";
    out.margin = align === "center" ? "0 auto" : align === "left" ? "0 auto 0 0" : "0 0 0 auto";
  }
  return out;
}

function computeBoxInnerStyle(style: ComponentBoxStyle): React.CSSProperties {
  const out: React.CSSProperties = {};
  if (style.textAlign !== null) out.textAlign = style.textAlign;
  if (style.padding !== null) out.padding = style.padding;
  const gradientFrom = style.backgroundGradient?.from ?? null;
  const gradientTo = style.backgroundGradient?.to ?? null;
  if (gradientFrom && gradientTo) {
    const angle = style.backgroundGradient?.angle ?? 135;
    out.background = `linear-gradient(${angle}deg, ${gradientFrom}, ${gradientTo})`;
  } else if (style.backgroundColor !== null) {
    out.backgroundColor = style.backgroundColor;
  }
  return out;
}

function computeButtonJustify(textAlign: ComponentBoxStyle["textAlign"]): React.CSSProperties["justifySelf"] {
  if (textAlign === "center") return "center";
  if (textAlign === "right") return "end";
  return "start";
}

function computeBackgroundValue(gradient: { from: string | null; to: string | null; angle: number | null } | null, solid: string | null): string | null {
  const from = gradient?.from ?? null;
  const to = gradient?.to ?? null;
  if (from && to) {
    const angle = gradient?.angle ?? 135;
    return `linear-gradient(${angle}deg, ${from}, ${to})`;
  }
  return solid ?? null;
}

function computeButtonInlineStyle(style: {
  variant: (typeof BUTTON_VARIANTS)[number] | null;
  bgColor: string | null;
  textColor: string | null;
  borderColor: string | null;
  radius: number | null;
}): React.CSSProperties {
  const out: React.CSSProperties = {};
  if (style.radius !== null) out.borderRadius = style.radius;
  if (style.variant === "outline") {
    out.background = "transparent";
    out.color = style.textColor ?? "var(--site-accent)";
    out.borderColor = style.borderColor ?? "var(--site-accent)";
    out.borderStyle = "solid";
    out.borderWidth = 1;
    return out;
  }
  if (style.bgColor !== null) out.background = style.bgColor;
  if (style.textColor !== null) out.color = style.textColor;
  if (style.borderColor !== null) out.borderColor = style.borderColor;
  return out;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createSection(label: string): Section {
  return {
    id: createId("sec"),
    label,
    style: { background: null, backgroundGradient: null, padding: null, maxWidth: null },
    settings: { visible: true, layout: "stack", gap: null, gridColumns: null },
    components: [],
  };
}

function createComponent(type: Component["type"]): Component {
  if (type === "hero") {
    return {
      id: createId("cmp"),
      type: "hero",
      headline: "Design. Compose. Publish.",
      subheadline: "A creative, local-first CMS editor with an agent that can reshape the page as you build.",
      primaryCtaText: "Contact",
      primaryCtaHref: "#contact",
      ctaStyle: { variant: null, bgColor: null, textColor: null, borderColor: null, radius: null },
      backgroundImageAssetId: null,
      style: { blockAlign: null, textAlign: null, maxWidth: null, padding: null, backgroundColor: null, backgroundGradient: null },
    };
  }
  if (type === "rich_text") {
    return {
      id: createId("cmp"),
      type: "rich_text",
      html: "<p>Write something compelling. Keep it clear, human, and specific.</p>",
      style: { blockAlign: null, textAlign: null, maxWidth: null, padding: null, backgroundColor: null, backgroundGradient: null },
    };
  }
  if (type === "contact_form") {
    return {
      id: createId("cmp"),
      type: "contact_form",
      headline: "Contact",
      submitLabel: "Send",
      submitStyle: { variant: null, bgColor: null, textColor: null, borderColor: null, radius: null },
      style: { blockAlign: null, textAlign: null, maxWidth: null, padding: null, backgroundColor: null, backgroundGradient: null },
    };
  }
  if (type === "image") {
    throw new Error("Use createImageComponent(assetId) for image components.");
  }
  throw new Error(`Unsupported component type: ${type}`);
}

function createImageComponent(assetId: string): Component {
  return {
    id: createId("cmp"),
    type: "image",
    assetId,
    caption: "",
    style: { fit: null, maxWidth: null, align: null, focalX: null, focalY: null, radius: null },
  };
}

function moveInArray<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return items;
  if (fromIndex < 0 || fromIndex >= items.length) return items;
  if (toIndex < 0 || toIndex >= items.length) return items;
  const copy = items.slice();
  const [item] = copy.splice(fromIndex, 1);
  if (item === undefined) return items;
  copy.splice(toIndex, 0, item);
  return copy;
}

function moveByIndexAllowEnd<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || fromIndex >= items.length) return items;
  if (toIndex < 0 || toIndex > items.length) return items;
  const copy = items.slice();
  const [item] = copy.splice(fromIndex, 1);
  if (item === undefined) return items;
  const adjustedIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
  const clamped = Math.max(0, Math.min(copy.length, adjustedIndex));
  if (clamped === fromIndex) return items;
  copy.splice(clamped, 0, item);
  return copy;
}

function escapeHtmlText(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function plainTextToRichTextHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return "";
  const escaped = escapeHtmlText(normalized).replace(/\n/g, "<br>");
  return `<p>${escaped}</p>`;
}

function sanitizeRichTextHref(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return trimmed;
  if (trimmed.startsWith("mailto:")) return trimmed;
  try {
    const url = new URL(trimmed, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    return null;
  } catch {
    return null;
  }
}

function insertRichTextLinkAtSelection(container: HTMLElement, href: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount < 1) return;
  const range = selection.getRangeAt(0);
  const ancestor =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!ancestor || !container.contains(ancestor)) return;

  const selectedText = selection.toString().trim();
  const link = document.createElement("a");
  link.setAttribute("href", href);
  link.textContent = selectedText.length ? selectedText : href;

  range.deleteContents();
  range.insertNode(link);

  const nextRange = document.createRange();
  nextRange.setStartAfter(link);
  nextRange.setEndAfter(link);
  selection.removeAllRanges();
  selection.addRange(nextRange);
}

function sanitizeRichTextHtml(inputHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${inputHtml}</div>`, "text/html");
  const wrapper = doc.body.firstElementChild;
  if (!wrapper) return "";

  const outDoc = document.implementation.createHTMLDocument("");
  const outWrapper = outDoc.createElement("div");

  const allowedTags = new Set(["p", "br", "strong", "em", "a", "ul", "ol", "li"]);

  function appendSanitized(parent: HTMLElement, node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(outDoc.createTextNode(node.textContent ?? ""));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const rawTag = el.tagName.toLowerCase();
    const tag = rawTag === "b" ? "strong" : rawTag === "i" ? "em" : rawTag === "div" ? "p" : rawTag;

    if (!allowedTags.has(tag)) {
      for (const child of Array.from(el.childNodes)) appendSanitized(parent, child);
      return;
    }

    const outEl = outDoc.createElement(tag);
    if (tag === "a") {
      const href = sanitizeRichTextHref(el.getAttribute("href"));
      if (href) outEl.setAttribute("href", href);
      const target = el.getAttribute("target");
      if (target === "_blank") {
        outEl.setAttribute("target", "_blank");
        outEl.setAttribute("rel", "noopener noreferrer");
      }
    }

    for (const child of Array.from(el.childNodes)) appendSanitized(outEl, child);
    parent.appendChild(outEl);
  }

  for (const child of Array.from(wrapper.childNodes)) appendSanitized(outWrapper, child);
  return outWrapper.innerHTML;
}

function sanitizeInlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

type DragPayload =
  | { kind: "section"; sectionId: string }
  | { kind: "component"; sectionId: string; componentId: string };

type DropPosition = "before" | "after";

let inMemoryDragPayload: DragPayload | null = null;

function setDragPayload(e: React.DragEvent, payload: DragPayload) {
  inMemoryDragPayload = payload;
  e.dataTransfer.effectAllowed = "move";
  const raw = JSON.stringify(payload);
  // Some browsers / automation harnesses only preserve `text/plain` during HTML5 DnD.
  e.dataTransfer.setData("application/x-cac", raw);
  e.dataTransfer.setData("text/plain", raw);
}

function clearDragPayload() {
  inMemoryDragPayload = null;
}

function getDragPayload(e: React.DragEvent): DragPayload | null {
  const candidates = [e.dataTransfer.getData("application/x-cac"), e.dataTransfer.getData("text/plain")].filter(
    (v) => v && v.trim().length
  );
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      const kind = (parsed as { kind?: unknown }).kind;
      if (kind === "section") {
        const sectionId = (parsed as { sectionId?: unknown }).sectionId;
        if (typeof sectionId === "string" && sectionId.length) return { kind: "section", sectionId };
      }
      if (kind === "component") {
        const sectionId = (parsed as { sectionId?: unknown }).sectionId;
        const componentId = (parsed as { componentId?: unknown }).componentId;
        if (typeof sectionId === "string" && sectionId.length && typeof componentId === "string" && componentId.length) {
          return { kind: "component", sectionId, componentId };
        }
      }
    } catch {
      // ignore
    }
  }
  return inMemoryDragPayload;
}

function computeDropPosition(rect: DOMRect, clientY: number): DropPosition {
  const mid = rect.top + rect.height / 2;
  return clientY >= mid ? "after" : "before";
}

let lastAutoScrollAtMs = 0;
function findScrollParent(start: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = start;
  while (el) {
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    const canScroll = (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
    if (canScroll) return el;
    el = el.parentElement;
  }
  const scrolling = document.scrollingElement;
  return scrolling && scrolling instanceof HTMLElement ? scrolling : null;
}

function autoScrollDuringDrag(target: HTMLElement, clientY: number) {
  const now = Date.now();
  if (now - lastAutoScrollAtMs < 30) return;
  lastAutoScrollAtMs = now;

  const scrollParent = findScrollParent(target);
  if (!scrollParent) return;
  const rect = scrollParent.getBoundingClientRect();

  const edge = 60;
  const maxStep = 22;
  const topDist = clientY - rect.top;
  const bottomDist = rect.bottom - clientY;

  if (topDist < edge) {
    const t = Math.max(0, Math.min(1, (edge - topDist) / edge));
    scrollParent.scrollTop -= Math.ceil(maxStep * t);
  } else if (bottomDist < edge) {
    const t = Math.max(0, Math.min(1, (edge - bottomDist) / edge));
    scrollParent.scrollTop += Math.ceil(maxStep * t);
  }
}

function moveComponentByIndex(args: {
  sections: Section[];
  fromSectionId: string;
  fromComponentId: string;
  toSectionId: string;
  toIndex: number; // 0..len (append allowed)
}): Section[] {
  const { sections, fromSectionId, fromComponentId, toSectionId, toIndex } = args;
  const fromSection = sections.find((s) => s.id === fromSectionId);
  const toSection = sections.find((s) => s.id === toSectionId);
  if (!fromSection || !toSection) return sections;
  const moving = fromSection.components.find((c) => c.id === fromComponentId);
  if (!moving) return sections;

  if (fromSectionId === toSectionId) {
    const fromIndex = fromSection.components.findIndex((c) => c.id === fromComponentId);
    if (fromIndex < 0) return sections;
    const remaining = fromSection.components.slice();
    remaining.splice(fromIndex, 1);
    const adjustedIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
    const clamped = Math.max(0, Math.min(remaining.length, adjustedIndex));
    if (clamped === fromIndex) return sections;
    remaining.splice(clamped, 0, moving);
    return sections.map((s) => (s.id === fromSectionId ? { ...s, components: remaining } : s));
  }

  return sections.map((s) => {
    if (s.id === fromSectionId) {
      return { ...s, components: s.components.filter((c) => c.id !== fromComponentId) };
    }
    if (s.id === toSectionId) {
      const next = s.components.slice();
      const clamped = Math.max(0, Math.min(next.length, toIndex));
      next.splice(clamped, 0, moving);
      return { ...s, components: next };
    }
    return s;
  });
}

function getEtagHeader(res: Response): string | null {
  const raw = res.headers.get("etag");
  if (!raw) return null;
  const etag = raw.trim();
  return etag.length ? etag : null;
}

class ApiConflictError extends Error {
  public readonly serverPage: Page;
  public readonly serverEtag: string | null;

  public constructor(message: string, serverPage: Page, serverEtag: string | null) {
    super(message);
    this.name = "ApiConflictError";
    this.serverPage = serverPage;
    this.serverEtag = serverEtag;
  }
}

async function apiGetPage(projectId: string): Promise<{ page: Page; etag: string | null }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/page`);
  if (!res.ok) throw new Error(`Failed to load page (${res.status})`);
  const json = (await res.json()) as unknown;
  const page = (json as { page?: unknown }).page;
  return { page: PageSchema.parse(page), etag: getEtagHeader(res) };
}

async function apiPutPage(
  projectId: string,
  page: Page,
  options?: { etag?: string | null; force?: boolean }
): Promise<string | null> {
  const query = options?.force ? "?force=1" : "";
  const headers: Record<string, string> = { "content-type": "application/json" };
  const etag = options?.etag ?? null;
  if (etag) headers["if-match"] = etag;

  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/page${query}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(page),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const serverPageRaw = json && typeof json === "object" ? (json as { page?: unknown }).page : undefined;
    if ((res.status === 409 || res.status === 412) && typeof serverPageRaw !== "undefined") {
      const serverPage = PageSchema.parse(serverPageRaw);
      throw new ApiConflictError("Page changed on disk (conflict).", serverPage, getEtagHeader(res));
    }
    throw new Error(`Failed to save page (${res.status})`);
  }
  return getEtagHeader(res);
}

const ExportConfigSchema = z.object({
  baseUrl: z.string().url().nullable().default(null),
  includeSitemap: z.boolean().default(true),
  includeRobotsTxt: z.boolean().default(true),
  allowIndexing: z.boolean().default(true),
  analyticsHtml: z.string().max(20_000).nullable().default(null),
  contactForm: z
    .object({
      mode: z.enum(["disabled", "formspree", "netlify", "custom"]).default("disabled"),
      actionUrl: z.string().url().nullable().default(null),
      netlifyFormName: z.string().min(1).nullable().default(null),
      successRedirectUrl: z.string().url().nullable().default(null),
    })
    .default({}),
});

type ExportConfig = z.infer<typeof ExportConfigSchema>;

async function apiGetExportConfig(projectId: string): Promise<ExportConfig> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export-config`);
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new Error(`Failed to load export config (${res.status})`);
  const config = (json as { config?: unknown }).config;
  return ExportConfigSchema.parse(config);
}

async function apiPutExportConfig(projectId: string, config: ExportConfig): Promise<ExportConfig> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export-config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new Error(`Failed to save export config (${res.status})`);
  const next = (json as { config?: unknown }).config;
  return ExportConfigSchema.parse(next);
}

const DiffSummarySchema = z.object({
  sections: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    reordered: z.boolean(),
    changed: z.number().int().nonnegative(),
  }),
  components: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    movedBetweenSections: z.number().int().nonnegative(),
    reorderedWithinSections: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
  }),
  assets: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
  }),
  approxJsonDeltaChars: z.number().int().nonnegative(),
});

type DiffSummary = z.infer<typeof DiffSummarySchema>;

const ScreenshotRequestOptionsSchema = z.object({
  width: z.number().int().positive().max(4096).optional(),
  height: z.number().int().positive().max(4096).optional(),
  fullPage: z.boolean().optional(),
});

async function apiAgentChat(
  projectId: string,
  message: string,
  mode: "suggest" | "apply",
  screenshotUrl?: string,
  etag?: string | null
): Promise<{
  assistantMessage: string;
  applied: boolean;
  page: Page;
  proposedPage?: Page;
  diffSummary?: DiffSummary;
  requestScreenshot?: boolean;
  requestScreenshotReason?: string;
  requestScreenshotOptions?: z.infer<typeof ScreenshotRequestOptionsSchema>;
  pageEtag: string | null;
}> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (etag) headers["if-match"] = etag;
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agent/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, mode, screenshotUrl }),
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const serverPageRaw = (json as { page?: unknown }).page;
    if ((res.status === 409 || res.status === 412) && typeof serverPageRaw !== "undefined") {
      const serverPage = PageSchema.parse(serverPageRaw);
      throw new ApiConflictError("Page changed while the agent was running (conflict).", serverPage, getEtagHeader(res));
    }
    const err = (json as { error?: string }).error ?? `Agent error (${res.status})`;
    throw new Error(err);
  }
  const assistantMessage = z.string().parse((json as { assistantMessage?: unknown }).assistantMessage);
  const applied = z.boolean().parse((json as { applied?: unknown }).applied);
  const page = PageSchema.parse((json as { page?: unknown }).page);
  const proposedPageRaw = (json as { proposedPage?: unknown }).proposedPage;
  const proposedPage = typeof proposedPageRaw === "undefined" ? undefined : PageSchema.parse(proposedPageRaw);
  const diffSummaryRaw = (json as { diffSummary?: unknown }).diffSummary;
  const diffSummary = typeof diffSummaryRaw === "undefined" ? undefined : DiffSummarySchema.parse(diffSummaryRaw);
  const requestScreenshot = z.boolean().optional().parse((json as { requestScreenshot?: unknown }).requestScreenshot);
  const requestScreenshotReason = z
    .string()
    .optional()
    .parse((json as { requestScreenshotReason?: unknown }).requestScreenshotReason);
  const requestScreenshotOptions = ScreenshotRequestOptionsSchema.optional().parse(
    (json as { requestScreenshotOptions?: unknown }).requestScreenshotOptions
  );
  const base = { assistantMessage, applied, page };
  const withProposal = proposedPage ? { ...base, proposedPage } : base;
  const withDiff = diffSummary ? { ...withProposal, diffSummary } : withProposal;
  const extra: Partial<{
    requestScreenshot: boolean;
    requestScreenshotReason: string;
    requestScreenshotOptions: z.infer<typeof ScreenshotRequestOptionsSchema>;
  }> = {};
  if (typeof requestScreenshot !== "undefined") extra.requestScreenshot = requestScreenshot;
  if (typeof requestScreenshotReason !== "undefined") extra.requestScreenshotReason = requestScreenshotReason;
  if (typeof requestScreenshotOptions !== "undefined") extra.requestScreenshotOptions = requestScreenshotOptions;

  return { ...withDiff, ...extra, pageEtag: getEtagHeader(res) };
}

async function apiApplyAgentProposal(
  projectId: string,
  message: string,
  basePage: Page,
  proposedPage: Page,
  etag?: string | null
): Promise<{ page: Page; diffSummary: DiffSummary; pageEtag: string | null }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (etag) headers["if-match"] = etag;
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agent/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, basePage, proposedPage }),
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const serverPageRaw = (json as { page?: unknown }).page;
    if ((res.status === 409 || res.status === 412) && typeof serverPageRaw !== "undefined") {
      const serverPage = PageSchema.parse(serverPageRaw);
      throw new ApiConflictError("Page changed on disk (conflict).", serverPage, getEtagHeader(res));
    }
    const err = (json as { error?: string }).error ?? `Agent apply error (${res.status})`;
    throw new Error(err);
  }
  const page = PageSchema.parse((json as { page?: unknown }).page);
  const diffSummary = DiffSummarySchema.parse((json as { diffSummary?: unknown }).diffSummary);
  return { page, diffSummary, pageEtag: getEtagHeader(res) };
}

async function apiUploadImage(projectId: string, file: File, alt?: string) {
  const form = new FormData();
  form.append("file", file);
  if (alt) form.append("alt", alt);
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets/images`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Failed to upload image (${res.status})`);
  const json = (await res.json()) as unknown;
  const asset = (json as { asset?: unknown }).asset;
  return AssetSchema.parse(asset);
}

async function apiReplaceImageAsset(
  projectId: string,
  assetId: string,
  file: File,
  etag?: string | null
): Promise<{ asset: Asset; page: Page; pageEtag: string | null }> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  if (etag) headers["if-match"] = etag;
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/assets/images/${encodeURIComponent(assetId)}/replace`,
    { method: "POST", body: form, headers }
  );
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const serverPageRaw = (json as { page?: unknown }).page;
    if ((res.status === 409 || res.status === 412) && typeof serverPageRaw !== "undefined") {
      const serverPage = PageSchema.parse(serverPageRaw);
      throw new ApiConflictError("Page changed on disk (conflict).", serverPage, getEtagHeader(res));
    }
    const err = (json as { error?: string }).error ?? `Asset replace error (${res.status})`;
    throw new Error(err);
  }
  const asset = AssetSchema.parse((json as { asset?: unknown }).asset);
  const page = PageSchema.parse((json as { page?: unknown }).page);
  return { asset, page, pageEtag: getEtagHeader(res) };
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("canvas.toBlob returned null"));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}

async function downscaleImageFile(file: File, maxDimensionPx: number): Promise<File> {
  if (!Number.isFinite(maxDimensionPx) || maxDimensionPx <= 0) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const maxDim = Math.max(bitmap.width, bitmap.height);
  if (maxDim <= maxDimensionPx) return file;

  const scale = maxDimensionPx / maxDim;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob =
    (await canvasToBlob(canvas, "image/webp", 0.9).catch(() => null)) ??
    (await canvasToBlob(canvas, file.type || "image/png", 0.9).catch(() => null)) ??
    (await canvasToBlob(canvas, "image/png"));

  const outExt = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
  const outName = file.name.replace(/\.[^.]+$/, "") + `.${outExt}`;

  return new File([blob], outName, { type: blob.type });
}

async function apiExport(projectId: string): Promise<{ outputDir: string }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const err = (json as { error?: string }).error ?? `Export error (${res.status})`;
    throw new Error(err);
  }
  const outputDir = z.string().parse((json as { outputDir?: unknown }).outputDir);
  return { outputDir };
}

async function apiCaptureScreenshot(
  projectId: string,
  options?: { width?: number; height?: number; fullPage?: boolean }
): Promise<{ screenshotUrl: string }> {
  const width = options?.width ?? 1024;
  const height = options?.height ?? 768;
  const fullPage = options?.fullPage ?? false;
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview/screenshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width, height, fullPage }),
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const err = (json as { error?: string }).error ?? `Screenshot error (${res.status})`;
    throw new Error(err);
  }
  const screenshotUrl = z.string().parse((json as { screenshotUrl?: unknown }).screenshotUrl);
  return { screenshotUrl };
}

async function apiListProjects(): Promise<string[]> {
  const res = await fetch("/api/projects");
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const err = (json as { error?: string }).error ?? `Projects error (${res.status})`;
    throw new Error(err);
  }
  return z.array(z.string()).parse((json as { projects?: unknown }).projects);
}

export function App() {
  const toast = useToast();
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);
  const [loadedProjectId, setLoadedProjectId] = useState(DEFAULT_PROJECT_ID);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [paletteTab, setPaletteTab] = useState<PaletteTab>("project");
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [dragOverComponentSectionId, setDragOverComponentSectionId] = useState<string | null>(null);
  const [previewSectionDropHint, setPreviewSectionDropHint] = useState<{ sectionId: string; position: DropPosition } | null>(
    null
  );
  const [editingSectionLabelId, setEditingSectionLabelId] = useState<string | null>(null);
  const [editingSectionLabelValue, setEditingSectionLabelValue] = useState("");
  const [selected, setSelected] = useState<{ sectionId: string; componentId?: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ serverPage: Page; serverEtag: string | null } | null>(null);
  const lastSavedJsonRef = useRef<string | null>(null);
  const pageEtagRef = useRef<string | null>(null);
  const [lastSavedAtMs, setLastSavedAtMs] = useState<number | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveTokenRef = useRef(0);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [optimizeUploads, setOptimizeUploads] = useState(true);
  const [maxUploadPx, setMaxUploadPx] = useState(1600);
  const [previewDeviceWidth, setPreviewDeviceWidth] = useState<number | null>(null);
  const [agentText, setAgentText] = useState("");
  const sttSupported = useMemo(() => isSttSupported(), []);
  const [sttLang, setSttLang] = useState(() => {
    const lang = (globalThis.navigator?.language || "en-US").trim();
    if (lang.toLowerCase().startsWith("cs")) return "cs-CZ";
    return lang || "en-US";
  });
  const [sttMode, setSttMode] = useState<"append" | "replace">("append");
  const [isSttActive, setIsSttActive] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [sttInterim, setSttInterim] = useState("");
  const sttBaseRef = useRef<string>("");
  const sttFinalRef = useRef<string>("");
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentRunMode, setAgentRunMode] = useState<"apply" | "suggest">("apply");
  const [agentProposal, setAgentProposal] = useState<Page | null>(null);
  const [agentProposalBasePage, setAgentProposalBasePage] = useState<Page | null>(null);
  const [agentProposalBaseJson, setAgentProposalBaseJson] = useState<string | null>(null);
  const [agentProposalMessage, setAgentProposalMessage] = useState<string | null>(null);
  const [agentProposalBaseEtag, setAgentProposalBaseEtag] = useState<string | null>(null);
  const [agentDiffSummary, setAgentDiffSummary] = useState<DiffSummary | null>(null);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [exportConfig, setExportConfig] = useState<ExportConfig | null>(null);
  const [exportConfigError, setExportConfigError] = useState<string | null>(null);
  const [exportBaseUrlInput, setExportBaseUrlInput] = useState("");
  const [exportAnalyticsHtmlInput, setExportAnalyticsHtmlInput] = useState("");
  const [exportContactActionUrlInput, setExportContactActionUrlInput] = useState("");
  const [exportContactNetlifyNameInput, setExportContactNetlifyNameInput] = useState("");
  const [exportContactSuccessRedirectInput, setExportContactSuccessRedirectInput] = useState("");
  const [isSavingExportConfig, setIsSavingExportConfig] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [imageEditor, setImageEditor] = useState<ImageEditorState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const latestPageRef = useRef<Page | null>(null);
  const latestPageJsonRef = useRef<string | null>(null);
  const page = state.kind === "ready" ? state.editor.page : null;
  const pageJson = useMemo(() => (page ? JSON.stringify(page) : null), [page]);
  const resolvedSiteTheme = useMemo(() => resolveTheme(page?.theme ?? null), [page?.theme]);
  const siteCssVars = useMemo(() => resolvedThemeToCssVars(resolvedSiteTheme), [resolvedSiteTheme]);
  const siteCssVarStyle = useMemo(() => siteCssVars as unknown as React.CSSProperties, [siteCssVars]);
  const isDirty = pageJson !== null && lastSavedJsonRef.current !== pageJson;
  const canEdit = state.kind === "ready" && loadedProjectId === projectId;
  const activeProjectId = loadedProjectId;
  const canUndo = canEdit && state.kind === "ready" && state.editor.past.length > 0;
  const canRedo = canEdit && state.kind === "ready" && state.editor.future.length > 0;

  const imageAssets = useMemo(() => {
    if (!page) return [];
    return page.assets.filter((a) => a.type === "image");
  }, [page]);

  const selectedSection = useMemo(() => {
    if (!page || !selected) return null;
    return page.sections.find((s) => s.id === selected.sectionId) ?? null;
  }, [page, selected]);

  const selectedComponent = useMemo(() => {
    if (!selectedSection || !selected?.componentId) return null;
    return selectedSection.components.find((c) => c.id === selected.componentId) ?? null;
  }, [selectedSection, selected]);

  const refreshProjects = useCallback(async () => {
    setIsProjectsLoading(true);
    setProjectsError(null);
    try {
      const next = await apiListProjects();
      setProjects(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setProjectsError(message);
      toast.error("Failed to load projects", message);
    } finally {
      setIsProjectsLoading(false);
    }
  }, [toast]);

  const load = useCallback(async (projectIdOverride?: string) => {
    const effectiveProjectId = projectIdOverride ?? projectId;
    if (projectIdOverride && projectIdOverride !== projectId) setProjectId(projectIdOverride);
    setState({ kind: "loading" });
    setExportConfig(null);
    setExportConfigError(null);
    try {
      const next = await apiGetPage(effectiveProjectId);
      pageEtagRef.current = next.etag;
      setConflict(null);
      setState({ kind: "ready", editor: { page: next.page, past: [], future: [] } });
      lastSavedJsonRef.current = JSON.stringify(next.page);
      setLastSavedAtMs(Date.now());
      setAutosaveError(null);
      setSaveError(null);
      setLoadedProjectId(effectiveProjectId);
      setSelected(null);
      setAgentReply(null);
      setAgentError(null);
      setAgentProposal(null);
      setAgentProposalBasePage(null);
      setAgentProposalBaseJson(null);
      setAgentProposalMessage(null);
      setAgentProposalBaseEtag(null);
      setAgentDiffSummary(null);
      void (async () => {
        try {
          const cfg = await apiGetExportConfig(effectiveProjectId);
          setExportConfig(cfg);
          setExportConfigError(null);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          setExportConfig(ExportConfigSchema.parse({}));
          setExportConfigError(message);
        }
      })();
      void refreshProjects();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setState({ kind: "error", message });
      setExportConfig(null);
      setExportConfigError(message);
      toast.error("Failed to load project", message);
    }
  }, [pageEtagRef, projectId, refreshProjects, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    latestPageRef.current = page;
    latestPageJsonRef.current = pageJson;
  }, [page, pageJson]);

  useEffect(() => {
    if (!exportConfig) return;
    setExportBaseUrlInput(exportConfig.baseUrl ?? "");
    setExportAnalyticsHtmlInput(exportConfig.analyticsHtml ?? "");
    setExportContactActionUrlInput(exportConfig.contactForm.actionUrl ?? "");
    setExportContactNetlifyNameInput(exportConfig.contactForm.netlifyFormName ?? "");
    setExportContactSuccessRedirectInput(exportConfig.contactForm.successRedirectUrl ?? "");
  }, [exportConfig]);

  const flushAutosaveTimer = useCallback(() => {
    autosaveTokenRef.current += 1;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }, []);

  const persistPage = useCallback(
    async (pageToSave: Page) => {
      const json = JSON.stringify(pageToSave);
      const run = async () => {
        try {
          const nextEtag = await apiPutPage(projectId, pageToSave, { etag: pageEtagRef.current });
          pageEtagRef.current = nextEtag;
          setConflict(null);
        } catch (error) {
          if (error instanceof ApiConflictError) {
            setConflict({ serverPage: error.serverPage, serverEtag: error.serverEtag });
          }
          throw error;
        }
        lastSavedJsonRef.current = json;
        setLastSavedAtMs(Date.now());
        setAutosaveError(null);
      };
      persistQueueRef.current = persistQueueRef.current.then(run, run);
      await persistQueueRef.current;
    },
    [projectId]
  );

  const ensureSaved = useCallback(
    async (pageToSave: Page) => {
      if (!isDirty) return;
      flushAutosaveTimer();
      await persistPage(pageToSave);
    },
    [flushAutosaveTimer, isDirty, persistPage]
  );

  const save = useCallback(async () => {
    if (!page) return;
    flushAutosaveTimer();
    setIsSaving(true);
    setSaveError(null);
    try {
      await persistPage(page);
      toast.success("Saved", `projects/${projectId}/page.json`);
    } catch (error) {
      if (error instanceof ApiConflictError) {
        setConflict({ serverPage: error.serverPage, serverEtag: error.serverEtag });
        setSaveError("Conflict: page changed on disk. Reload or overwrite.");
        toast.error("Save conflict", "Page changed on disk. Reload or overwrite.");
      } else {
        const message = error instanceof Error ? error.message : "Unknown error";
        setSaveError(message);
        toast.error("Save failed", message);
      }
    } finally {
      setIsSaving(false);
    }
  }, [flushAutosaveTimer, page, persistPage, projectId, toast]);

  const reloadAfterConflict = useCallback(() => {
    if (!conflict) return;
    flushAutosaveTimer();
    pageEtagRef.current = conflict.serverEtag;
    setState({ kind: "ready", editor: { page: conflict.serverPage, past: [], future: [] } });
    lastSavedJsonRef.current = JSON.stringify(conflict.serverPage);
    setLastSavedAtMs(Date.now());
    setAutosaveError(null);
    setSaveError(null);
    setSelected(null);
    setConflict(null);
    toast.success("Reloaded latest from disk");
  }, [conflict, flushAutosaveTimer, toast]);

  const overwriteAfterConflict = useCallback(async () => {
    if (!page) return;
    flushAutosaveTimer();
    setIsSaving(true);
    setSaveError(null);
    try {
      const nextEtag = await apiPutPage(activeProjectId, page, { force: true });
      pageEtagRef.current = nextEtag;
      setConflict(null);
      lastSavedJsonRef.current = JSON.stringify(page);
      setLastSavedAtMs(Date.now());
      setAutosaveError(null);
      toast.success("Overwrote disk version", `projects/${activeProjectId}/page.json`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setSaveError(message);
      toast.error("Overwrite failed", message);
    } finally {
      setIsSaving(false);
    }
  }, [activeProjectId, flushAutosaveTimer, page, toast]);

  useEffect(() => {
    if (!autosaveEnabled) return;
    if (!canEdit) return;
    if (!isDirty) return;
    if (isSaving || isAutosaving || isExporting || isCapturingScreenshot || isAgentRunning) return;

    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);

    const token = (autosaveTokenRef.current += 1);
    autosaveTimerRef.current = window.setTimeout(() => {
      if (token !== autosaveTokenRef.current) return;
      const latest = latestPageRef.current;
      const latestJson = latestPageJsonRef.current;
      if (!latest || !latestJson) return;
      if (lastSavedJsonRef.current === latestJson) return;

      setIsAutosaving(true);
      setAutosaveError(null);

      void persistPage(latest)
        .catch((error: unknown) => {
          if (error instanceof ApiConflictError) {
            setConflict({ serverPage: error.serverPage, serverEtag: error.serverEtag });
            setAutosaveError("Conflict: page changed on disk. Reload or overwrite.");
            toast.error("Autosave conflict", "Page changed on disk. Reload or overwrite.");
            return;
          }
          const message = error instanceof Error ? error.message : "Unknown error";
          setAutosaveError(message);
          toast.error("Autosave failed", message);
        })
        .finally(() => {
          setIsAutosaving(false);
        });
    }, 900);

    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [
    autosaveEnabled,
    canEdit,
    isAgentRunning,
    isAutosaving,
    isCapturingScreenshot,
    isDirty,
    isExporting,
    isSaving,
    persistPage,
    toast,
  ]);

  const updatePage = useCallback((updater: (prev: Page) => Page, options?: { recordUndo?: boolean }) => {
    const recordUndo = options?.recordUndo ?? true;
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const current = prev.editor.page;
      const next = updater(current);
      if (Object.is(next, current)) return prev;
      if (!recordUndo) return { kind: "ready", editor: { ...prev.editor, page: next } };
      const past = [...prev.editor.past, current].slice(-UNDO_LIMIT);
      return { kind: "ready", editor: { page: next, past, future: [] } };
    });
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const { past, future, page } = prev.editor;
      const previous = past[past.length - 1];
      if (!previous) return prev;
      const nextPast = past.slice(0, -1);
      const nextFuture = [page, ...future].slice(0, UNDO_LIMIT);
      return { kind: "ready", editor: { page: previous, past: nextPast, future: nextFuture } };
    });
    setSelected(null);
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const { past, future, page } = prev.editor;
      const next = future[0];
      if (!next) return prev;
      const nextPast = [...past, page].slice(-UNDO_LIMIT);
      const nextFuture = future.slice(1);
      return { kind: "ready", editor: { page: next, past: nextPast, future: nextFuture } };
    });
    setSelected(null);
  }, []);

  useEffect(() => {
    if (!canEdit || isSaving) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        if (target.closest("input,textarea,select,[contenteditable='true']")) return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && selected) {
        const dir = e.key === "ArrowUp" ? -1 : 1;
        e.preventDefault();
        updatePage((prev) => {
          if (selected.componentId) {
            const nextSections = prev.sections.map((section) => {
              if (section.id !== selected.sectionId) return section;
              const idx = section.components.findIndex((c) => c.id === selected.componentId);
              if (idx < 0) return section;
              const nextIdx = idx + dir;
              if (nextIdx < 0 || nextIdx >= section.components.length) return section;
              const nextComponents = [...section.components];
              const moved = nextComponents[idx];
              if (!moved) return section;
              nextComponents.splice(idx, 1);
              nextComponents.splice(nextIdx, 0, moved);
              return { ...section, components: nextComponents };
            });
            return PageSchema.parse({ ...prev, sections: nextSections });
          }

          const idx = prev.sections.findIndex((s) => s.id === selected.sectionId);
          if (idx < 0) return prev;
          const nextIdx = idx + dir;
          if (nextIdx < 0 || nextIdx >= prev.sections.length) return prev;
          const nextSections = [...prev.sections];
          const moved = nextSections[idx];
          if (!moved) return prev;
          nextSections.splice(idx, 1);
          nextSections.splice(nextIdx, 0, moved);
          return PageSchema.parse({ ...prev, sections: nextSections });
        });
        return;
      }

      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        if (!canUndo) return;
        e.preventDefault();
        undo();
        return;
      }

      if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        if (!canRedo) return;
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, canRedo, canUndo, isSaving, redo, selected, undo, updatePage]);

  const updateComponentInPage = useCallback(
    (sectionId: string, componentId: string, updater: (prev: Component) => Component) => {
      updatePage((prev) => {
        const nextSections = prev.sections.map((section) => {
          if (section.id !== sectionId) return section;
          return {
            ...section,
            components: section.components.map((c) => (c.id === componentId ? updater(c) : c)),
          };
        });
        return PageSchema.parse({ ...prev, sections: nextSections });
      });
    },
    [updatePage]
  );

  const addSectionWithComponent = useCallback(
    (componentType: Component["type"], label: string) => {
      updatePage((prev) => {
        const section = createSection(label);
        const component = createComponent(componentType);
        section.components.push(component);
        const next: Page = { ...prev, sections: [...prev.sections, section] };
        return PageSchema.parse(next);
      });
    },
    [updatePage]
  );

  const moveSection = useCallback(
    (sectionId: string, delta: -1 | 1) => {
      updatePage((prev) => {
        const index = prev.sections.findIndex((s) => s.id === sectionId);
        if (index < 0) return prev;
        const nextSections = moveInArray(prev.sections, index, index + delta);
        return PageSchema.parse({ ...prev, sections: nextSections });
      });
    },
    [updatePage]
  );

  const uploadImage = useCallback(async () => {
    if (!page) return;
    const input = fileInputRef.current;
    if (!input || !input.files || input.files.length === 0) return;
    const file = input.files[0];
    if (!file) return;
    input.value = "";

    const toUpload = optimizeUploads ? await downscaleImageFile(file, maxUploadPx) : file;
    const asset = await apiUploadImage(activeProjectId, toUpload);
    updatePage((prev) => {
      const next = PageSchema.parse({
        ...prev,
        assets: [...prev.assets, asset],
        sections: [
          ...prev.sections,
          {
            ...createSection("Image"),
            components: [createImageComponent(asset.id)],
          },
        ],
      });
      return next;
    });
  }, [page, projectId, updatePage, optimizeUploads, maxUploadPx]);

  const uploadImageAssetOnly = useCallback(
    async (file: File) => {
      const toUpload = optimizeUploads ? await downscaleImageFile(file, maxUploadPx) : file;
      const asset = await apiUploadImage(activeProjectId, toUpload);
      updatePage((prev) => PageSchema.parse({ ...prev, assets: [...prev.assets, asset] }));
      return asset;
    },
    [activeProjectId, maxUploadPx, optimizeUploads, updatePage]
  );

  const replaceImageAssetFile = useCallback(
    async (assetId: string, file: File) => {
      if (!page) return;
      flushAutosaveTimer();
      const toUpload = optimizeUploads ? await downscaleImageFile(file, maxUploadPx) : file;
      try {
        const result = await apiReplaceImageAsset(activeProjectId, assetId, toUpload, pageEtagRef.current);
        pageEtagRef.current = result.pageEtag;
        setConflict(null);
        updatePage(() => result.page, { recordUndo: true });
        lastSavedJsonRef.current = JSON.stringify(result.page);
        setLastSavedAtMs(Date.now());
        setAutosaveError(null);
        toast.success("Asset replaced", result.asset.filename);
      } catch (error) {
        if (error instanceof ApiConflictError) {
          setConflict({ serverPage: error.serverPage, serverEtag: error.serverEtag });
          toast.error("Asset replace conflict", "Page changed on disk. Reload or overwrite.");
          return;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        toast.error("Asset replace failed", message);
      }
    },
    [activeProjectId, flushAutosaveTimer, maxUploadPx, optimizeUploads, page, toast, updatePage]
  );

  const replaceAssetIdUsagesInPage = useCallback(
    (oldAssetId: string, newAssetId: string) => {
      updatePage((prev) => {
        const nextSections = prev.sections.map((s) => ({
          ...s,
          components: s.components.map((c) => {
            if (c.type === "hero" && c.backgroundImageAssetId === oldAssetId) return { ...c, backgroundImageAssetId: newAssetId };
            if (c.type === "image" && c.assetId === oldAssetId) return { ...c, assetId: newAssetId };
            return c;
          }),
        }));
        return PageSchema.parse({ ...prev, sections: nextSections });
      });
    },
    [updatePage]
  );

  const removeSection = useCallback(
    (sectionId: string) => {
      updatePage((prev) => {
        const next: Page = { ...prev, sections: prev.sections.filter((s) => s.id !== sectionId) };
        return PageSchema.parse(next);
      });
      setSelected((prev) => (prev?.sectionId === sectionId ? null : prev));
    },
    [updatePage]
  );

  const appendTranscript = useCallback((prev: string, next: string) => {
    const cleaned = next.replace(/\s+/g, " ").trim();
    if (!cleaned) return prev;
    const base = prev.trimEnd();
    if (!base) return cleaned;
    if (/[({[\n\r\t ]$/.test(base)) return `${base}${cleaned}`;
    return `${base} ${cleaned}`;
  }, []);

  const stopAgentStt = useCallback(() => {
    stopStt();
    setIsSttActive(false);
    setSttInterim("");
  }, []);

  const toggleAgentStt = useCallback(() => {
    if (!sttSupported) return;
    setSttError(null);

    if (isSttActive) {
      stopAgentStt();
      setAgentText(appendTranscript(sttBaseRef.current, sttFinalRef.current));
      sttFinalRef.current = "";
      return;
    }

    sttBaseRef.current = sttMode === "replace" ? "" : agentText.trim();
    sttFinalRef.current = "";
    setSttInterim("");
    setAgentText(sttBaseRef.current);

    const ok = startStt(sttLang, {
      onStart: () => setIsSttActive(true),
      onEnd: () => {
        setIsSttActive(false);
        setSttInterim("");
        setAgentText(appendTranscript(sttBaseRef.current, sttFinalRef.current));
        sttFinalRef.current = "";
      },
      onError: (error) => {
        setSttError(error);
        setIsSttActive(false);
        setSttInterim("");
      },
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          sttFinalRef.current = appendTranscript(sttFinalRef.current, text);
          setSttInterim("");
          setAgentText(appendTranscript(sttBaseRef.current, sttFinalRef.current));
        } else {
          const interim = text.replace(/\s+/g, " ").trim();
          setSttInterim(interim);
          setAgentText(appendTranscript(appendTranscript(sttBaseRef.current, sttFinalRef.current), interim));
        }
      },
    });

    if (!ok) {
      setSttError("Speech recognition is not supported in this browser.");
      setIsSttActive(false);
    }
  }, [agentText, appendTranscript, isSttActive, stopAgentStt, sttLang, sttMode, sttSupported]);

  const runAgent = useCallback(async () => {
    if (!page) return;
    const trimmed = agentText.trim();
    if (!trimmed) return;
    if (isSttActive) stopAgentStt();
    setIsAgentRunning(true);
    setAgentError(null);
    setAgentProposal(null);
    setAgentProposalBasePage(null);
    setAgentProposalBaseJson(null);
    setAgentProposalMessage(null);
    setAgentProposalBaseEtag(null);
    setAgentDiffSummary(null);
    try {
      await ensureSaved(page);

      const baseJson = latestPageJsonRef.current;
      if (!baseJson) {
        throw new Error("Internal error: missing base page snapshot for agent run.");
      }
      const baseEtag = pageEtagRef.current;

      let latestScreenshotUrl: string | undefined;
      try {
        const shot = await apiCaptureScreenshot(activeProjectId, { width: 1024, height: 768, fullPage: false });
        latestScreenshotUrl = shot.screenshotUrl;
        setScreenshotUrl(shot.screenshotUrl);
      } catch {
        // Best-effort: continue without screenshot (server might not have Playwright installed).
      }

      const runChat = async (shotUrl?: string) =>
        await apiAgentChat(activeProjectId, trimmed, agentRunMode, shotUrl, baseEtag);

      let result = await runChat(latestScreenshotUrl);
      if (result.requestScreenshot) {
        setAgentReply(result.assistantMessage);
        toast.info("Agent requested a screenshot", result.requestScreenshotReason ?? "Capturing and retrying…");
        try {
          const options = result.requestScreenshotOptions;
          const shot = await apiCaptureScreenshot(activeProjectId, {
            width: options?.width ?? 1024,
            height: options?.height ?? 768,
            fullPage: options?.fullPage ?? false,
          });
          latestScreenshotUrl = shot.screenshotUrl;
          setScreenshotUrl(shot.screenshotUrl);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Screenshot capture failed";
          setAgentError(message);
          toast.error("Screenshot capture failed", message);
          return;
        }

        if (latestPageJsonRef.current !== baseJson) {
          setAgentError("Page changed while capturing a screenshot. Result discarded (rerun the agent).");
          toast.error("Agent result discarded", "Page changed while capturing screenshot.");
          return;
        }

        result = await runChat(latestScreenshotUrl);
        if (result.requestScreenshot) {
          setAgentReply(result.assistantMessage);
          setAgentError("Agent asked for another screenshot. Stopping to avoid a loop; try capturing manually and rerun.");
          toast.error("Agent needs screenshot", "Capture manually and rerun.");
          return;
        }
      }
      setAgentReply(result.assistantMessage);
      setAgentDiffSummary(result.diffSummary ?? null);
      if (latestPageJsonRef.current !== baseJson) {
        setAgentError("Page changed while the agent was running. Result discarded (rerun the agent).");
        toast.error("Agent result discarded", "Page changed while running.");
        return;
      }
      if (result.applied) {
        pageEtagRef.current = result.pageEtag;
        setConflict(null);
        updatePage(() => result.page, { recordUndo: true });
        lastSavedJsonRef.current = JSON.stringify(result.page);
        setLastSavedAtMs(Date.now());
        setAutosaveError(null);
        setSelected(null);
        toast.success("Agent applied changes");
      } else if (result.proposedPage) {
        setAgentProposalBaseEtag(result.pageEtag);
        setAgentProposal(result.proposedPage);
        setAgentProposalBasePage(page);
        setAgentProposalBaseJson(baseJson);
        setAgentProposalMessage(trimmed);
        toast.success("Agent suggested changes", "Review and apply when ready.");
      } else {
        toast.error("Agent returned no proposal");
      }
    } catch (error) {
      if (error instanceof ApiConflictError) {
        setConflict({ serverPage: error.serverPage, serverEtag: error.serverEtag });
        setAgentError("Conflict: page changed on disk. Reload or overwrite.");
        toast.error("Agent conflict", "Page changed on disk. Reload or overwrite.");
      } else {
        const message = error instanceof Error ? error.message : "Unknown error";
        setAgentError(message);
        toast.error("Agent failed", message);
      }
    } finally {
      setIsAgentRunning(false);
    }
  }, [activeProjectId, agentRunMode, agentText, ensureSaved, isSttActive, page, stopAgentStt, toast, updatePage]);

  const applyAgentProposal = useCallback(async () => {
    if (!agentProposal) return;
    if (isSaving) return;
    if (!agentProposalBasePage || !agentProposalMessage || !agentProposalBaseJson) {
      toast.error("Cannot apply suggestion", "Missing base state (rerun the agent).");
      return;
    }
    if (latestPageJsonRef.current !== agentProposalBaseJson) {
      toast.error("Cannot apply suggestion", "Page changed since suggestion (rerun the agent).");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await apiApplyAgentProposal(
        activeProjectId,
        agentProposalMessage,
        agentProposalBasePage,
        agentProposal,
        agentProposalBaseEtag
      );
      pageEtagRef.current = result.pageEtag;
      setConflict(null);
      updatePage(() => result.page, { recordUndo: true });
      lastSavedJsonRef.current = JSON.stringify(result.page);
      setLastSavedAtMs(Date.now());
      setAutosaveError(null);
      setAgentDiffSummary(result.diffSummary);
      setAgentProposal(null);
      setAgentProposalBasePage(null);
      setAgentProposalBaseJson(null);
      setAgentProposalMessage(null);
      setAgentProposalBaseEtag(null);
      setSelected(null);
      toast.success("Applied suggestion", `projects/${activeProjectId}/page.json`);
    } catch (error) {
      if (error instanceof ApiConflictError) {
        setConflict({ serverPage: error.serverPage, serverEtag: error.serverEtag });
        setSaveError("Conflict: page changed on disk. Reload or overwrite.");
        toast.error("Apply conflict", "Page changed on disk. Reload or overwrite.");
      } else {
        const message = error instanceof Error ? error.message : "Unknown error";
        setSaveError(message);
        toast.error("Apply failed", message);
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    activeProjectId,
    agentProposal,
    agentProposalBaseJson,
    agentProposalBasePage,
    agentProposalBaseEtag,
    agentProposalMessage,
    isSaving,
    toast,
    updatePage,
  ]);

  const saveExportConfig = useCallback(async () => {
    if (!exportConfig) return;
    setIsSavingExportConfig(true);
    setExportConfigError(null);
    try {
      const baseUrl = exportBaseUrlInput.trim() ? exportBaseUrlInput.trim() : null;
      const analyticsHtml = exportAnalyticsHtmlInput.trim() ? exportAnalyticsHtmlInput.trim() : null;
      const contactMode = exportConfig.contactForm.mode;
      const actionUrlRaw = exportContactActionUrlInput.trim();
      const netlifyNameRaw = exportContactNetlifyNameInput.trim();
      const redirectRaw = exportContactSuccessRedirectInput.trim();

      let contactForm: ExportConfig["contactForm"] = { ...exportConfig.contactForm };
      if (contactMode === "disabled") {
        contactForm = { mode: "disabled", actionUrl: null, netlifyFormName: null, successRedirectUrl: null };
      } else if (contactMode === "netlify") {
        contactForm = {
          mode: "netlify",
          actionUrl: null,
          netlifyFormName: netlifyNameRaw || "contact",
          successRedirectUrl: redirectRaw || null,
        };
      } else {
        if (!actionUrlRaw) {
          throw new Error("Contact form action URL is required for Formspree/Custom modes.");
        }
        contactForm = {
          mode: contactMode,
          actionUrl: actionUrlRaw,
          netlifyFormName: null,
          successRedirectUrl: null,
        };
      }

      const next = ExportConfigSchema.parse({ ...exportConfig, baseUrl, analyticsHtml, contactForm });
      const saved = await apiPutExportConfig(activeProjectId, next);
      setExportConfig(saved);
      toast.success("Saved export settings", `projects/${activeProjectId}/export.json`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setExportConfigError(message);
      toast.error("Failed to save export settings", message);
    } finally {
      setIsSavingExportConfig(false);
    }
  }, [
    activeProjectId,
    exportAnalyticsHtmlInput,
    exportBaseUrlInput,
    exportConfig,
    exportContactActionUrlInput,
    exportContactNetlifyNameInput,
    exportContactSuccessRedirectInput,
    toast,
  ]);

  const exportProject = useCallback(async () => {
    if (!page) return;
    setIsExporting(true);
    setExportError(null);
    try {
      await ensureSaved(page);
      const result = await apiExport(activeProjectId);
      setExportInfo(result.outputDir);
      toast.success("Exported", result.outputDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setExportError(message);
      toast.error("Export failed", message);
    } finally {
      setIsExporting(false);
    }
  }, [activeProjectId, ensureSaved, page, toast]);

  const captureScreenshot = useCallback(async () => {
    setIsCapturingScreenshot(true);
    setScreenshotError(null);
    try {
      if (page) await ensureSaved(page);
      const result = await apiCaptureScreenshot(activeProjectId, { width: 1200, height: 720, fullPage: true });
      setScreenshotUrl(result.screenshotUrl);
      toast.success("Screenshot captured");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setScreenshotError(message);
      toast.error("Screenshot failed", message);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [activeProjectId, ensureSaved, page, toast]);

  const openPaletteTab = useCallback((tab: PaletteTab) => {
    setPaletteTab((current) => {
      if (current === tab) {
        setPaletteCollapsed((prev) => !prev);
        return current;
      }
      setPaletteCollapsed(false);
      return tab;
    });
  }, []);

  return (
    <div className="shell">
      <div className="panel">
        <div className="panelHeader">
          <h2>Palette</h2>
          <span className="badge">MVP</span>
        </div>
        <div className="panelBody panelBodyPalette">
          <div className="paletteLayout">
            <div className="paletteActivityBar" aria-label="Palette tabs">
              <button
                type="button"
                className={paletteTab === "project" && !paletteCollapsed ? "paletteTabBtn paletteTabBtnActive" : "paletteTabBtn"}
                data-testid="palette-tab-project"
                onClick={() => openPaletteTab("project")}
                title="Project"
                aria-label="Project"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 7.5c0-1.1.9-2 2-2h5l2 2h7c1.1 0 2 .9 2 2V18c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V7.5Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className={paletteTab === "agent" && !paletteCollapsed ? "paletteTabBtn paletteTabBtnActive" : "paletteTabBtn"}
                data-testid="palette-tab-agent"
                onClick={() => openPaletteTab("agent")}
                title="Agent"
                aria-label="Agent"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M8 9a4 4 0 0 1 8 0v1.5c0 .8.7 1.5 1.5 1.5H18a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2h.5c.8 0 1.5-.7 1.5-1.5V9Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path d="M9.5 20v-1.5M14.5 20v-1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                className={paletteTab === "add" && !paletteCollapsed ? "paletteTabBtn paletteTabBtnActive" : "paletteTabBtn"}
                data-testid="palette-tab-add"
                onClick={() => openPaletteTab("add")}
                title="Add blocks"
                aria-label="Add blocks"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                className={paletteTab === "assets" && !paletteCollapsed ? "paletteTabBtn paletteTabBtnActive" : "paletteTabBtn"}
                data-testid="palette-tab-images"
                onClick={() => openPaletteTab("assets")}
                title="Images + Assets"
                aria-label="Images + Assets"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 14.5l2.2-2.2a1.6 1.6 0 0 1 2.3 0L16 13.8l1.2-1.2a1.6 1.6 0 0 1 2.3 0L20 13.1"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <path d="M9 10.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z" fill="currentColor" />
                </svg>
              </button>
            </div>

            {paletteCollapsed ? null : (
              <div className="paletteSidebar">
                <div className="paletteSidebarHeader">
                  <div className="paletteSidebarTitle" data-testid="palette-active-title">
                    {paletteTab === "project"
                      ? "Project"
                      : paletteTab === "agent"
                        ? "Agent"
                        : paletteTab === "add"
                          ? "Add blocks"
                          : "Images + Assets"}
                  </div>
                </div>
                <div className="paletteSidebarBody">
                  {paletteTab === "project" ? (
                    <div className="stack">
                      <div className="field">
                        <label>Project</label>
                        <div className="row">
                          <input data-testid="project-id" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
                          <button className="btn" data-testid="project-load" onClick={() => void load()}>
                            Load
                          </button>
                        </div>
                        <div className="muted">
                          Storage is local (filesystem). Current project: <b>{projectId}</b>
                          <span className="badge" data-testid="load-state" style={{ marginLeft: 8 }}>
                            {state.kind}
                          </span>
                          <span className="badge" data-testid="loaded-project" style={{ marginLeft: 8, opacity: 0.85 }}>
                            loaded: {loadedProjectId}
                          </span>
                        </div>
                        <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                          <div className="muted">Projects</div>
                          <button className="btn" onClick={() => void refreshProjects()} disabled={isProjectsLoading}>
                            {isProjectsLoading ? "Refreshing..." : "Refresh"}
                          </button>
                        </div>
                        {state.kind === "error" ? (
                          <div className="errorBox" style={{ marginTop: 10 }}>
                            <div className="errorBoxTitle">Load error</div>
                            <div>{state.message}</div>
                          </div>
                        ) : null}
                        {projectsError ? (
                          <div className="errorBox" style={{ marginTop: 10 }}>
                            <div className="errorBoxTitle">Projects error</div>
                            <div>{projectsError}</div>
                          </div>
                        ) : null}
                        {projects.length ? (
                          <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                            {projects.map((p) => (
                              <button
                                key={p}
                                className="btn"
                                style={{ padding: "6px 10px", opacity: p === projectId ? 1 : 0.8 }}
                                onClick={() => {
                                  void load(p);
                                }}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="muted">No projects yet. Load a new project id to create one.</div>
                        )}
                      </div>

                      <div className="card">
                        <div className="cardTitle">Save / Export</div>
                        <div className="row">
                          <button className="btn" data-testid="undo-page" onClick={() => undo()} disabled={!canUndo || isSaving}>
                            Undo
                          </button>
                          <button className="btn" data-testid="redo-page" onClick={() => redo()} disabled={!canRedo || isSaving}>
                            Redo
                          </button>
                          <div className="muted" style={{ marginLeft: "auto" }}>
                            Ctrl/⌘+Z, Ctrl/⌘+Shift+Z
                          </div>
                        </div>
                        <div className="row">
                          <button
                            className="btn btnPrimary"
                            data-testid="save-page"
                            onClick={() => void save()}
                            disabled={!canEdit || isSaving}
                          >
                            {isSaving ? "Saving..." : "Save page.json"}
                          </button>
                          <button className="btn" data-testid="reload-page" onClick={() => void load()} disabled={isSaving}>
                            Reload
                          </button>
                        </div>
                        {conflict ? (
                          <div className="errorBox" style={{ marginTop: 10 }}>
                            <div className="errorBoxTitle">Conflict</div>
                            <div>Page changed on disk (another tab/process saved a newer version).</div>
                            <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 10 }}>
                              <button className="btn" onClick={() => reloadAfterConflict()} disabled={isSaving}>
                                Reload latest
                              </button>
                              <button className="btn btnPrimary" onClick={() => void overwriteAfterConflict()} disabled={!page || isSaving}>
                                Overwrite with my version
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {saveError ? (
                          <div className="errorBox" style={{ marginTop: 10 }}>
                            <div className="errorBoxTitle">Save error</div>
                            <div>{saveError}</div>
                          </div>
                        ) : null}
                        <div className="muted">
                          Writes to <code>projects/&lt;projectId&gt;/page.json</code>.
                        </div>
                        <div className="row" style={{ marginTop: 10, alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                          <label className="row" style={{ gap: 8, alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={autosaveEnabled}
                              onChange={(e) => setAutosaveEnabled(e.target.checked)}
                              disabled={!canEdit}
                            />
                            <span className="muted">Autosave</span>
                          </label>
                          {isAutosaving ? (
                            <span className="badge" data-testid="save-status">
                              autosaving…
                            </span>
                          ) : isDirty ? (
                            <span className="badge" data-testid="save-status">
                              unsaved
                            </span>
                          ) : (
                            <span className="badge" data-testid="save-status" style={{ opacity: 0.8 }}>
                              saved
                            </span>
                          )}
                          {lastSavedAtMs ? (
                            <span className="muted">Last saved: {new Date(lastSavedAtMs).toLocaleTimeString()}</span>
                          ) : null}
                        </div>
                        {autosaveError ? (
                          <div className="errorBox" style={{ marginTop: 10 }}>
                            <div className="errorBoxTitle">Autosave error</div>
                            <div>{autosaveError}</div>
                          </div>
                        ) : null}
                        <div className="row" style={{ marginTop: 10 }}>
                          <button
                            className="btn"
                            data-testid="export-site"
                            onClick={() => void exportProject()}
                            disabled={!page || isExporting || isSaving}
                          >
                            {isExporting ? "Exporting..." : "Export static site"}
                          </button>
                          <button
                            className="btn"
                            data-testid="capture-screenshot"
                            onClick={() => void captureScreenshot()}
                            disabled={!page || isCapturingScreenshot || isSaving}
                          >
                            {isCapturingScreenshot ? "Capturing..." : "Capture screenshot"}
                          </button>
                        </div>
                        <div className="card" style={{ marginTop: 10 }}>
                          <div className="cardTitle">Export settings</div>
                          {exportConfigError ? (
                            <div className="errorBox" style={{ marginTop: 10 }}>
                              <div className="errorBoxTitle">Export config error</div>
                              <div>{exportConfigError}</div>
                            </div>
                          ) : null}
                          {exportConfig ? (
                            <div className="stack" style={{ gap: 10 }}>
                              <div className="field">
                                <label>Base URL</label>
                                <input
                                  data-testid="export-config-baseurl"
                                  value={exportBaseUrlInput}
                                  disabled={!canEdit || isSavingExportConfig || isSaving}
                                  onChange={(e) => setExportBaseUrlInput(e.target.value)}
                                  placeholder="https://example.com"
                                />
                                <div className="muted">
                                  Used for canonical + og:url in exported HTML, and for generating <code>sitemap.xml</code> / <code>robots.txt</code>.
                                </div>
                              </div>

                              <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                                <label className="row" style={{ gap: 8, alignItems: "center" }}>
                                  <input
                                    type="checkbox"
                                    checked={exportConfig.includeRobotsTxt}
                                    disabled={!canEdit || isSavingExportConfig || isSaving}
                                    onChange={(e) =>
                                      setExportConfig((prev) => (prev ? { ...prev, includeRobotsTxt: e.target.checked } : prev))
                                    }
                                  />
                                  <span className="muted">robots.txt</span>
                                </label>
                                <label className="row" style={{ gap: 8, alignItems: "center" }}>
                                  <input
                                    type="checkbox"
                                    checked={exportConfig.allowIndexing}
                                    disabled={!canEdit || isSavingExportConfig || isSaving}
                                    onChange={(e) => setExportConfig((prev) => (prev ? { ...prev, allowIndexing: e.target.checked } : prev))}
                                  />
                                  <span className="muted">Allow indexing</span>
                                </label>
                                <label className="row" style={{ gap: 8, alignItems: "center" }}>
                                  <input
                                    type="checkbox"
                                    checked={exportConfig.includeSitemap}
                                    disabled={!canEdit || isSavingExportConfig || isSaving}
                                    onChange={(e) =>
                                      setExportConfig((prev) => (prev ? { ...prev, includeSitemap: e.target.checked } : prev))
                                    }
                                  />
                                  <span className="muted">sitemap.xml (requires Base URL)</span>
                                </label>
                              </div>

                              <div className="field">
                                <label>Analytics (raw HTML)</label>
                                <textarea
                                  rows={4}
                                  data-testid="export-config-analytics"
                                  value={exportAnalyticsHtmlInput}
                                  disabled={!canEdit || isSavingExportConfig || isSaving}
                                  onChange={(e) => setExportAnalyticsHtmlInput(e.target.value)}
                                  placeholder='Example: <script defer src="..."></script>'
                                />
                                <div className="muted">Injected into the exported HTML head.</div>
                              </div>

                              <div className="field">
                                <label>Contact form submit</label>
                                <select
                                  data-testid="export-config-contact-mode"
                                  value={exportConfig.contactForm.mode}
                                  disabled={!canEdit || isSavingExportConfig || isSaving}
                                  onChange={(e) => {
                                    const mode =
                                      e.target.value === "formspree"
                                        ? "formspree"
                                        : e.target.value === "netlify"
                                          ? "netlify"
                                          : e.target.value === "custom"
                                            ? "custom"
                                            : "disabled";
                                    setExportConfig((prev) => (prev ? { ...prev, contactForm: { ...prev.contactForm, mode } } : prev));
                                  }}
                                >
                                  <option value="disabled">disabled (no submit)</option>
                                  <option value="netlify">Netlify Forms</option>
                                  <option value="formspree">Formspree</option>
                                  <option value="custom">Custom endpoint</option>
                                </select>
                                <div className="muted">
                                  This affects the exported static site only (not the editor preview).
                                </div>
                              </div>

                              {exportConfig.contactForm.mode === "netlify" ? (
                                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                                  <div className="field" style={{ minWidth: 240, flex: 1 }}>
                                    <label>Netlify form name</label>
                                    <input
                                      data-testid="export-config-contact-netlify-name"
                                      value={exportContactNetlifyNameInput}
                                      disabled={!canEdit || isSavingExportConfig || isSaving}
                                      onChange={(e) => setExportContactNetlifyNameInput(e.target.value)}
                                      placeholder="contact"
                                    />
                                  </div>
                                  <div className="field" style={{ minWidth: 320, flex: 2 }}>
                                    <label>Success redirect (optional)</label>
                                    <input
                                      data-testid="export-config-contact-netlify-redirect"
                                      value={exportContactSuccessRedirectInput}
                                      disabled={!canEdit || isSavingExportConfig || isSaving}
                                      onChange={(e) => setExportContactSuccessRedirectInput(e.target.value)}
                                      placeholder="/thanks"
                                    />
                                  </div>
                                </div>
                              ) : null}

                              {exportConfig.contactForm.mode === "formspree" || exportConfig.contactForm.mode === "custom" ? (
                                <div className="field">
                                  <label>Action URL</label>
                                  <input
                                    data-testid="export-config-contact-action"
                                    value={exportContactActionUrlInput}
                                    disabled={!canEdit || isSavingExportConfig || isSaving}
                                    onChange={(e) => setExportContactActionUrlInput(e.target.value)}
                                    placeholder="https://example.com/submit"
                                  />
                                </div>
                              ) : null}

                              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                                <button
                                  className="btn"
                                  data-testid="export-config-save"
                                  disabled={!canEdit || isSavingExportConfig || isSaving || !exportConfig}
                                  onClick={() => void saveExportConfig()}
                                >
                                  {isSavingExportConfig ? "Saving..." : "Save export settings"}
                                </button>
                                <div className="muted">Stored as <code>projects/&lt;id&gt;/export.json</code>.</div>
                              </div>
                            </div>
                          ) : (
                            <div className="muted">Loading export settings…</div>
                          )}
                        </div>
                        {exportError ? (
                          <div className="errorBox" style={{ marginTop: 10 }}>
                            <div className="errorBoxTitle">Export error</div>
                            <div>{exportError}</div>
                          </div>
                        ) : null}
                        {screenshotError ? (
                          <div className="errorBox" style={{ marginTop: 10 }}>
                            <div className="errorBoxTitle">Screenshot error</div>
                            <div>{screenshotError}</div>
                          </div>
                        ) : null}
                        {exportInfo ? (
                          <div className="muted">
                            Exported to <code data-testid="export-output-dir">{exportInfo}</code>
                          </div>
                        ) : null}
                        {screenshotUrl ? (
                          <div className="stack" style={{ marginTop: 10 }}>
                            <div className="muted">
                              Latest: <code>{screenshotUrl}</code>
                            </div>
                            <img
                              src={screenshotUrl}
                              alt="Preview screenshot"
                              data-testid="preview-screenshot"
                              style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)" }}
                            />
                          </div>
                        ) : (
                          <div className="muted" style={{ marginTop: 8 }}>
                            Screenshot capture requires Playwright on the server.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {paletteTab === "agent" ? (
                    <div className="card">
                      <div className="cardTitle">Agent</div>
                      <div className="field">
                        <label>Ask the agent to edit the page</label>
                        <textarea
                          rows={4}
                          data-testid="agent-text"
                          value={agentText}
                          onChange={(e) => setAgentText(e.target.value)}
                          placeholder='Example: "Make the hero headline shorter and more specific to a sleep coaching business."'
                        />
                        <div className="row" style={{ marginTop: 8, alignItems: "flex-end", justifyContent: "space-between" }}>
                          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <button
                              className={isSttActive ? "btn btnPrimary" : "btn"}
                              data-testid="agent-mic"
                              disabled={!sttSupported || isAgentRunning}
                              onClick={() => toggleAgentStt()}
                              title={sttSupported ? "Speech-to-text" : "Speech-to-text is not supported in this browser"}
                            >
                              {isSttActive ? "Stop mic" : "Mic"}
                            </button>
                            <div className="field" style={{ width: 140 }}>
                              <label>Lang</label>
                              <input
                                value={sttLang}
                                onChange={(e) => setSttLang(e.target.value)}
                                disabled={!sttSupported || isAgentRunning}
                              />
                            </div>
                            <div className="field" style={{ width: 140 }}>
                              <label>Mode</label>
                              <select
                                value={sttMode}
                                onChange={(e) => setSttMode(e.target.value === "replace" ? "replace" : "append")}
                                disabled={!sttSupported || isAgentRunning || isSttActive}
                              >
                                <option value="append">append</option>
                                <option value="replace">replace</option>
                              </select>
                            </div>
                            <div className="field" style={{ width: 160 }}>
                              <label>Run</label>
                              <select
                                data-testid="agent-run-mode"
                                value={agentRunMode}
                                onChange={(e) => setAgentRunMode(e.target.value === "suggest" ? "suggest" : "apply")}
                                disabled={isAgentRunning}
                              >
                                <option value="apply">apply</option>
                                <option value="suggest">suggest</option>
                              </select>
                            </div>
                            {sttInterim ? <span className="badge">listening…</span> : null}
                          </div>
                        </div>
                        {sttError ? (
                          <div className="errorBox" style={{ marginTop: 10 }}>
                            <div className="errorBoxTitle">Mic error</div>
                            <div>{sttError}</div>
                          </div>
                        ) : null}
                      </div>
                      <div className="row">
                        <button
                          className="btn btnPrimary"
                          data-testid="agent-run"
                          onClick={() => void runAgent()}
                          disabled={!page || isAgentRunning}
                        >
                          {isAgentRunning ? "Running..." : agentRunMode === "suggest" ? "Suggest changes" : "Run agent"}
                        </button>
                        <button
                          className="btn"
                          onClick={() => {
                            setAgentReply(null);
                            setAgentError(null);
                            setAgentProposal(null);
                            setAgentProposalBasePage(null);
                            setAgentProposalBaseJson(null);
                            setAgentProposalMessage(null);
                            setAgentDiffSummary(null);
                          }}
                          disabled={!agentReply && !agentError && !agentProposal && !agentDiffSummary}
                        >
                          Clear reply
                        </button>
                      </div>
                      {agentProposal ? (
                        <div className="row" style={{ marginTop: 10 }}>
                          <button className="btn btnPrimary" onClick={() => void applyAgentProposal()} disabled={isSaving || isAgentRunning}>
                            Apply suggestion
                          </button>
                          <button
                            className="btn"
                            onClick={() => {
                              setAgentProposal(null);
                              setAgentProposalBasePage(null);
                              setAgentProposalBaseJson(null);
                              setAgentProposalMessage(null);
                              setAgentDiffSummary(null);
                            }}
                            disabled={isSaving || isAgentRunning}
                          >
                            Discard
                          </button>
                        </div>
                      ) : null}
                      {agentError ? (
                        <div className="errorBox" style={{ marginTop: 10 }}>
                          <div className="errorBoxTitle">Agent error</div>
                          <div>{agentError}</div>
                        </div>
                      ) : null}
                      {agentDiffSummary ? (
                        <div className="muted" style={{ marginTop: 10 }}>
                          Diff: sections +{agentDiffSummary.sections.added}/-{agentDiffSummary.sections.removed}, components +{agentDiffSummary.components.added}
                          /-{agentDiffSummary.components.removed}, moved {agentDiffSummary.components.movedBetweenSections}, edited{" "}
                          {agentDiffSummary.components.changed}, reorders s:{agentDiffSummary.sections.reordered ? "yes" : "no"} c:
                          {agentDiffSummary.components.reorderedWithinSections}; assets +{agentDiffSummary.assets.added}/-{agentDiffSummary.assets.removed}; JSON Δ{" "}
                          {agentDiffSummary.approxJsonDeltaChars}
                        </div>
                      ) : null}
                      {agentReply ? <div className="muted">{agentReply}</div> : <div className="muted">Uses `OPENAI_API_KEY` from `.env`.</div>}
                    </div>
                  ) : null}

                  {paletteTab === "add" ? (
                    <div className="stack">
                      <button
                        className="btn btnPrimary"
                        data-testid="add-hero"
                        onClick={() => addSectionWithComponent("hero", "Hero")}
                        disabled={!canEdit}
                      >
                        Add Hero
                      </button>
                      <button
                        className="btn"
                        data-testid="add-text"
                        onClick={() => addSectionWithComponent("rich_text", "Text")}
                        disabled={!canEdit}
                      >
                        Add Text
                      </button>
                      <button
                        className="btn"
                        data-testid="add-contact"
                        onClick={() => addSectionWithComponent("contact_form", "Contact")}
                        disabled={!canEdit}
                      >
                        Add Contact Form
                      </button>
                    </div>
                  ) : null}

                  {paletteTab === "assets" ? (
                    <div className="stack">
                      <div className="card">
                        <div className="cardTitle">Images</div>
                        <div className="row" style={{ alignItems: "flex-end" }}>
                          <label className="row" style={{ gap: 8, alignItems: "center", flex: 1 }}>
                            <input type="checkbox" checked={optimizeUploads} onChange={(e) => setOptimizeUploads(e.target.checked)} />
                            <span className="muted">Optimize (downscale)</span>
                          </label>
                          <div className="field" style={{ width: 120 }}>
                            <label>Max px</label>
                            <input
                              value={String(maxUploadPx)}
                              onChange={(e) => setMaxUploadPx(Number(e.target.value || "0"))}
                              inputMode="numeric"
                            />
                          </div>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          data-testid="upload-image"
                          disabled={!canEdit}
                          onChange={() => void uploadImage()}
                        />
                        <div className="muted">
                          Uploads to <code>projects/&lt;projectId&gt;/assets</code> and inserts an image block.
                        </div>
                      </div>

                      <div className="card">
                        <div className="cardTitle">Assets</div>
                        {page ? (
                          imageAssets.length ? (
                            <div className="stack">
                              {imageAssets.map((asset) => (
                                <div key={asset.id} className="row" style={{ alignItems: "flex-start" }}>
                                  <img
                                    src={`/projects/${encodeURIComponent(activeProjectId)}/assets/${encodeURIComponent(asset.filename)}`}
                                    alt={asset.alt}
                                    style={{
                                      width: 44,
                                      height: 44,
                                      borderRadius: 10,
                                      objectFit: "cover",
                                      border: "1px solid rgba(255,255,255,0.1)",
                                    }}
                                  />
                                  <div className="field" style={{ flex: 1 }}>
                                    <label>Alt</label>
                                    <input
                                      value={asset.alt}
                                      disabled={!canEdit}
                                      onChange={(e) =>
                                        updatePage((prev) =>
                                          PageSchema.parse({
                                            ...prev,
                                            assets: prev.assets.map((a) =>
                                              a.type === "image" && a.id === asset.id ? { ...a, alt: e.target.value } : a
                                            ),
                                          })
                                        )
                                      }
                                    />
                                  </div>
                                  <div className="row" style={{ paddingTop: 18, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                    <label
                                      className="btn"
                                      style={!canEdit ? { opacity: 0.6, pointerEvents: "none" } : undefined}
                                      data-testid="asset-replace-btn"
                                    >
                                      Replace file
                                      <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        style={{ display: "none" }}
                                        data-testid="asset-replace-input"
                                        onChange={async (e) => {
                                          const file = e.currentTarget.files?.[0];
                                          e.currentTarget.value = "";
                                          if (!file) return;
                                          try {
                                            await replaceImageAssetFile(asset.id, file);
                                          } catch (error) {
                                            const message = error instanceof Error ? error.message : "Unknown error";
                                            toast.error("Replace failed", message);
                                          }
                                        }}
                                      />
                                    </label>
                                    <button
                                      className="btn"
                                      disabled={!canEdit}
                                      data-testid="asset-edit-btn"
                                      onClick={() => setImageEditor({ kind: "asset", assetId: asset.id, replaceAllUsages: false })}
                                    >
                                      Edit
                                    </button>
                                  </div>
                                </div>
                              ))}
                              <div className="muted">
                                Alt text is stored in <code>page.json</code> (asset metadata).
                              </div>
                            </div>
                          ) : (
                            <div className="muted">No assets yet. Upload an image to start a library.</div>
                          )
                        ) : (
                          <div className="muted">Loading…</div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {state.kind === "error" ? <div className="card">{state.message}</div> : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panelHeader">
          <h2>Preview</h2>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <select
              aria-label="Preview viewport"
              data-testid="preview-viewport"
              value={previewDeviceWidth === null ? "auto" : String(previewDeviceWidth)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "auto") {
                  setPreviewDeviceWidth(null);
                  return;
                }
                const n = Number(v);
                setPreviewDeviceWidth(Number.isFinite(n) && n > 0 ? n : null);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "rgba(255,255,255,0.85)",
                color: "var(--text)",
              }}
            >
              <option value="auto">auto</option>
              <option value="375">mobile (375)</option>
              <option value="768">tablet (768)</option>
              <option value="1024">desktop (1024)</option>
            </select>
            <span className="badge">{page ? `${page.sections.length} sections` : "…"}</span>
          </div>
        </div>
        <div className="panelBody">
          <div className="canvas">
            <div className="previewViewport" style={previewDeviceWidth ? { maxWidth: previewDeviceWidth, margin: "0 auto" } : undefined}>
            <div className="preview">
              {page ? (
                <div className="sitePreviewRoot" style={siteCssVarStyle}>
                <div className="stack" style={{ gap: "var(--site-space-3)" }}>
                  {page.sections
                    .filter((section) => section.settings.visible)
                    .map((section) => {
                      const hintPos =
                        previewSectionDropHint && previewSectionDropHint.sectionId === section.id ? previewSectionDropHint.position : null;
                      return (
                        <div
                          key={section.id}
                          className={
                            hintPos
                              ? hintPos === "before"
                                ? "previewSectionWrap previewSectionWrapDropBefore"
                                : "previewSectionWrap previewSectionWrapDropAfter"
                              : "previewSectionWrap"
                          }
                          data-testid="preview-section-wrap"
                          data-section-id={section.id}
                          onDragOver={(e) => {
                            if (!canEdit) return;
                            const payload = getDragPayload(e);
                            if (!payload || payload.kind !== "section") return;
                            e.preventDefault();
                            autoScrollDuringDrag(e.currentTarget as HTMLElement, e.clientY);
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const position = computeDropPosition(rect, e.clientY);
                            setPreviewSectionDropHint((prev) =>
                              prev && prev.sectionId === section.id && prev.position === position ? prev : { sectionId: section.id, position }
                            );
                          }}
                          onDragLeave={(e) => {
                            const related = e.relatedTarget;
                            if (related && related instanceof Node && (e.currentTarget as HTMLElement).contains(related)) return;
                            setPreviewSectionDropHint((prev) => (prev?.sectionId === section.id ? null : prev));
                          }}
                          onDrop={(e) => {
                            if (!canEdit) return;
                            const payload = getDragPayload(e);
                            if (!payload || payload.kind !== "section") return;
                            e.preventDefault();
                            clearDragPayload();
                            setPreviewSectionDropHint(null);
                            if (payload.sectionId === section.id) return;
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const position = computeDropPosition(rect, e.clientY);
                            updatePage((prev) => {
                              const fromIndex = prev.sections.findIndex((s) => s.id === payload.sectionId);
                              const targetIndex = prev.sections.findIndex((s) => s.id === section.id);
                              if (fromIndex < 0 || targetIndex < 0) return prev;
                              const toIndex = position === "after" ? targetIndex + 1 : targetIndex;
                              return PageSchema.parse({ ...prev, sections: moveByIndexAllowEnd(prev.sections, fromIndex, toIndex) });
                            });
                          }}
                        >
                          {canEdit ? (
                            <div
                              className="previewSectionHandle"
                              data-testid="preview-section-handle"
                              data-section-id={section.id}
                              draggable
                              onDragStart={(e) => {
                                setDragPayload(e, { kind: "section", sectionId: section.id });
                              }}
                              onDragEnd={() => {
                                setTimeout(() => clearDragPayload(), 0);
                                setPreviewSectionDropHint(null);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected({ sectionId: section.id });
                              }}
                              title="Drag section"
                            >
                              ⋮⋮
                            </div>
                          ) : null}

                          <div
                            className="previewSection"
                            data-testid="preview-section"
                            data-section-id={section.id}
                            style={{
                              background: computeBackgroundValue(section.style.backgroundGradient, section.style.background) ?? undefined,
                              padding: section.style.padding !== null ? section.style.padding : undefined,
                              maxWidth: section.style.maxWidth ?? 980,
                            }}
                          >
                            <div
                              data-testid="preview-section-inner"
                              style={{
                                gap: section.settings.gap ?? 12,
                                display: section.settings.layout === "grid" ? "grid" : "flex",
                                gridTemplateColumns:
                                  section.settings.layout === "grid"
                                    ? `repeat(${section.settings.gridColumns ?? 2}, minmax(0, 1fr))`
                                    : undefined,
                                alignItems: section.settings.layout === "grid" ? "start" : undefined,
                                flexDirection: section.settings.layout === "grid" ? undefined : "column",
                              }}
                            >
                      {section.components.map((component) => (
                        <PreviewComponent
                          key={component.id}
                          sectionId={section.id}
                          component={component}
                          page={page}
                          projectId={activeProjectId}
                          isSelected={selected?.sectionId === section.id && selected?.componentId === component.id}
                          canEdit={canEdit}
                          onSelect={() => setSelected({ sectionId: section.id, componentId: component.id })}
                          onUpdate={(next) => updateComponentInPage(section.id, component.id, () => next)}
                          onDelete={() => {
                            if (!canEdit) return;
                            updatePage((prev) => {
                              const nextSections = prev.sections.map((s) =>
                                s.id === section.id ? { ...s, components: s.components.filter((c) => c.id !== component.id) } : s
                              );
                              return PageSchema.parse({ ...prev, sections: nextSections });
                            });
                            setSelected((prevSel) => (prevSel?.componentId === component.id ? null : prevSel));
                          }}
                          onDuplicate={() => {
                            if (!canEdit) return;
                            updatePage((prev) => {
                              const nextSections = prev.sections.map((s) => {
                                if (s.id !== section.id) return s;
                                const idx = s.components.findIndex((c) => c.id === component.id);
                                if (idx < 0) return s;
                                const copy: Component = { ...s.components[idx]!, id: createId("cmp") };
                                const next = s.components.slice();
                                next.splice(idx + 1, 0, copy);
                                return { ...s, components: next };
                              });
                              return PageSchema.parse({ ...prev, sections: nextSections });
                            });
                          }}
                          onUploadImageAssetOnly={uploadImageAssetOnly}
                          onEditImage={() => {
                            if (component.type !== "image") return;
                            setImageEditor({
                              kind: "component",
                              assetId: component.assetId,
                              sectionId: section.id,
                              componentId: component.id,
                              replaceAllUsages: false,
                            });
                          }}
                          onMoveHere={(_fromSectionId, fromComponentId, position) => {
                            if (!canEdit) return;
                            updatePage((prev) => {
                              const fromSection = prev.sections.find((s) => s.components.some((c) => c.id === fromComponentId));
                              const toSection = prev.sections.find((s) => s.id === section.id);
                              if (!fromSection || !toSection) return prev;
                              const actualFromSectionId = fromSection.id;
                              const targetIndex = toSection.components.findIndex((c) => c.id === component.id);
                              if (targetIndex < 0) return prev;
                              const toIndex = position === "after" ? targetIndex + 1 : targetIndex;

                              const nextSections = moveComponentByIndex({
                                sections: prev.sections,
                                fromSectionId: actualFromSectionId,
                                fromComponentId,
                                toSectionId: section.id,
                                toIndex,
                              });

                              return PageSchema.parse({ ...prev, sections: nextSections });
                            });

                            setSelected((prevSel) =>
                              prevSel?.componentId === fromComponentId ? { sectionId: section.id, componentId: fromComponentId } : prevSel
                            );
                          }}
                        />
                      ))}
                        <PreviewDropZone
                          key={`${section.id}-dropzone`}
                          sectionId={section.id}
                          onMoveToEnd={(_fromSectionId, fromComponentId) => {
                            if (!canEdit) return;
                            updatePage((prev) => {
                              const fromSection = prev.sections.find((s) => s.components.some((c) => c.id === fromComponentId));
                              const toSection = prev.sections.find((s) => s.id === section.id);
                              if (!fromSection || !toSection) return prev;
                              const actualFromSectionId = fromSection.id;
                              const nextSections = moveComponentByIndex({
                                sections: prev.sections,
                                fromSectionId: actualFromSectionId,
                                fromComponentId,
                                toSectionId: section.id,
                                toIndex: toSection.components.length,
                              });

                              return PageSchema.parse({ ...prev, sections: nextSections });
                            });

                            setSelected((prevSel) =>
                              prevSel?.componentId === fromComponentId ? { sectionId: section.id, componentId: fromComponentId } : prevSel
                            );
                          }}
                        />
                      </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
                </div>
              ) : (
                <div className="muted">Loading…</div>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panelHeader">
          <h2>Structure</h2>
          <span className="badge">{selectedComponent ? selectedComponent.type : selectedSection ? "section" : "none"}</span>
        </div>
        <div className="panelBody">
          {page ? (
            <div className="stack">
              <div className="card">
                <div className="cardTitle">Page metadata</div>
                <div className="stack">
                  <div className="field">
                    <label>Title</label>
                    <input
                      value={page.metadata.title}
                      disabled={!canEdit}
                      onChange={(e) =>
                        updatePage((prev) =>
                          PageSchema.parse({ ...prev, metadata: { ...prev.metadata, title: e.target.value } })
                        )
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Description</label>
                    <textarea
                      rows={3}
                      value={page.metadata.description}
                      disabled={!canEdit}
                      onChange={(e) =>
                        updatePage((prev) =>
                          PageSchema.parse({ ...prev, metadata: { ...prev.metadata, description: e.target.value } })
                        )
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="cardTitle">Theme</div>
                <div className="stack">
                  <div className="field">
                    <label>Preset</label>
                    <select
                      data-testid="theme-preset"
                      value={page.theme.preset ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => {
                        const nextPreset = e.target.value ? (e.target.value as (typeof THEME_PRESETS)[number]) : null;
                        updatePage((prev) =>
                          PageSchema.parse({
                            ...prev,
                            theme: {
                              preset: nextPreset,
                              fontFamily: null,
                              baseFontSize: null,
                              lineHeight: null,
                              bgColor: null,
                              textColor: null,
                              mutedTextColor: null,
                              accentColor: null,
                              spaceBase: null,
                              radius: null,
                            },
                          })
                        );
                      }}
                    >
                      <option value="">(default)</option>
                      {THEME_PRESETS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <div className="field" style={{ width: 160 }}>
                      <label>Background</label>
                      <input
                        type="color"
                        data-testid="theme-bg"
                        value={page.theme.bgColor ?? resolvedSiteTheme.bgColor}
                        disabled={!canEdit}
                        onChange={(e) =>
                          updatePage((prev) =>
                            PageSchema.parse({ ...prev, theme: { ...prev.theme, bgColor: e.target.value } })
                          )
                        }
                      />
                      <button
                        className="btn"
                        onClick={() => updatePage((prev) => PageSchema.parse({ ...prev, theme: { ...prev.theme, bgColor: null } }))}
                        disabled={!canEdit || page.theme.bgColor === null}
                      >
                        Auto
                      </button>
                    </div>
                    <div className="field" style={{ width: 160 }}>
                      <label>Text</label>
                      <input
                        type="color"
                        value={page.theme.textColor ?? resolvedSiteTheme.textColor}
                        disabled={!canEdit}
                        onChange={(e) =>
                          updatePage((prev) =>
                            PageSchema.parse({ ...prev, theme: { ...prev.theme, textColor: e.target.value } })
                          )
                        }
                      />
                      <button
                        className="btn"
                        onClick={() =>
                          updatePage((prev) => PageSchema.parse({ ...prev, theme: { ...prev.theme, textColor: null } }))
                        }
                        disabled={!canEdit || page.theme.textColor === null}
                      >
                        Auto
                      </button>
                    </div>
                    <div className="field" style={{ width: 160 }}>
                      <label>Muted</label>
                      <input
                        type="color"
                        value={page.theme.mutedTextColor ?? resolvedSiteTheme.mutedTextColor}
                        disabled={!canEdit}
                        onChange={(e) =>
                          updatePage((prev) =>
                            PageSchema.parse({ ...prev, theme: { ...prev.theme, mutedTextColor: e.target.value } })
                          )
                        }
                      />
                      <button
                        className="btn"
                        onClick={() =>
                          updatePage((prev) =>
                            PageSchema.parse({ ...prev, theme: { ...prev.theme, mutedTextColor: null } })
                          )
                        }
                        disabled={!canEdit || page.theme.mutedTextColor === null}
                      >
                        Auto
                      </button>
                    </div>
                    <div className="field" style={{ width: 160 }}>
                      <label>Accent</label>
                      <input
                        type="color"
                        data-testid="theme-accent"
                        value={page.theme.accentColor ?? resolvedSiteTheme.accentColor}
                        disabled={!canEdit}
                        onChange={(e) =>
                          updatePage((prev) =>
                            PageSchema.parse({ ...prev, theme: { ...prev.theme, accentColor: e.target.value } })
                          )
                        }
                      />
                      <button
                        className="btn"
                        onClick={() =>
                          updatePage((prev) => PageSchema.parse({ ...prev, theme: { ...prev.theme, accentColor: null } }))
                        }
                        disabled={!canEdit || page.theme.accentColor === null}
                      >
                        Auto
                      </button>
                    </div>
                  </div>

                  <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div className="field" style={{ width: 220 }}>
                      <label>Font family (CSS)</label>
                      <input
                        value={page.theme.fontFamily ?? ""}
                        placeholder="(auto)"
                        disabled={!canEdit}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          updatePage((prev) =>
                            PageSchema.parse({ ...prev, theme: { ...prev.theme, fontFamily: raw ? raw : null } })
                          );
                        }}
                      />
                    </div>
                    <div className="field" style={{ width: 140 }}>
                      <label>Base size</label>
                      <input
                        inputMode="numeric"
                        data-testid="theme-base-font"
                        value={String(page.theme.baseFontSize ?? resolvedSiteTheme.baseFontSize)}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const n = raw ? Number(raw) : NaN;
                          const clamped = Number.isFinite(n) ? Math.max(12, Math.min(22, Math.round(n))) : null;
                          updatePage((prev) =>
                            PageSchema.parse({
                              ...prev,
                              theme: { ...prev.theme, baseFontSize: clamped },
                            })
                          );
                        }}
                      />
                      <button
                        className="btn"
                        onClick={() =>
                          updatePage((prev) => PageSchema.parse({ ...prev, theme: { ...prev.theme, baseFontSize: null } }))
                        }
                        disabled={!canEdit || page.theme.baseFontSize === null}
                      >
                        Auto
                      </button>
                    </div>
                    <div className="field" style={{ width: 140 }}>
                      <label>Line height</label>
                      <input
                        value={String(page.theme.lineHeight ?? resolvedSiteTheme.lineHeight)}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const n = raw ? Number(raw) : NaN;
                          const clamped = Number.isFinite(n) ? Math.max(1.1, Math.min(1.8, n)) : null;
                          updatePage((prev) =>
                            PageSchema.parse({
                              ...prev,
                              theme: { ...prev.theme, lineHeight: clamped },
                            })
                          );
                        }}
                      />
                      <button
                        className="btn"
                        onClick={() =>
                          updatePage((prev) => PageSchema.parse({ ...prev, theme: { ...prev.theme, lineHeight: null } }))
                        }
                        disabled={!canEdit || page.theme.lineHeight === null}
                      >
                        Auto
                      </button>
                    </div>
                    <div className="field" style={{ width: 140 }}>
                      <label>Spacing</label>
                      <input
                        inputMode="numeric"
                        value={String(page.theme.spaceBase ?? resolvedSiteTheme.spaceBase)}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const n = raw ? Number(raw) : NaN;
                          const clamped = Number.isFinite(n) ? Math.max(4, Math.min(14, Math.round(n))) : null;
                          updatePage((prev) =>
                            PageSchema.parse({
                              ...prev,
                              theme: { ...prev.theme, spaceBase: clamped },
                            })
                          );
                        }}
                      />
                      <button
                        className="btn"
                        onClick={() =>
                          updatePage((prev) => PageSchema.parse({ ...prev, theme: { ...prev.theme, spaceBase: null } }))
                        }
                        disabled={!canEdit || page.theme.spaceBase === null}
                      >
                        Auto
                      </button>
                    </div>
                    <div className="field" style={{ width: 140 }}>
                      <label>Radius</label>
                      <input
                        inputMode="numeric"
                        value={String(page.theme.radius ?? resolvedSiteTheme.radius)}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const n = raw ? Number(raw) : NaN;
                          const clamped = Number.isFinite(n) ? Math.max(0, Math.min(28, Math.round(n))) : null;
                          updatePage((prev) =>
                            PageSchema.parse({
                              ...prev,
                              theme: { ...prev.theme, radius: clamped },
                            })
                          );
                        }}
                      />
                      <button
                        className="btn"
                        onClick={() =>
                          updatePage((prev) => PageSchema.parse({ ...prev, theme: { ...prev.theme, radius: null } }))
                        }
                        disabled={!canEdit || page.theme.radius === null}
                      >
                        Auto
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="list">
                {page.sections.map((section, idx) => (
                  <div
                    key={section.id}
                    className="card"
                    data-testid="structure-section-card"
                    data-section-id={section.id}
                    onDragOverCapture={(e) => {
                      if (!canEdit) return;
                      const payload = getDragPayload(e);
                      if (!payload) return;
                      if (payload.kind === "section") {
                        e.preventDefault();
                        setDragOverSectionId(section.id);
                      }
                    }}
                    onDragLeave={(e) => {
                      const related = e.relatedTarget;
                      if (related && related instanceof Node && (e.currentTarget as HTMLElement).contains(related)) return;
                      setDragOverSectionId((prev) => (prev === section.id ? null : prev));
                    }}
                    onDropCapture={(e) => {
                      if (!canEdit) return;
                      const payload = getDragPayload(e);
                      if (!payload || payload.kind !== "section") return;
                      e.preventDefault();
                      clearDragPayload();
                      setDragOverSectionId(null);

                      if (payload.sectionId === section.id) return;
                      updatePage((prev) => {
                        const fromIndex = prev.sections.findIndex((s) => s.id === payload.sectionId);
                        const toIndex = prev.sections.findIndex((s) => s.id === section.id);
                        return PageSchema.parse({ ...prev, sections: moveInArray(prev.sections, fromIndex, toIndex) });
                      });
                    }}
                    style={
                      dragOverSectionId === section.id
                        ? { outline: "2px solid rgba(124, 92, 255, 0.55)", outlineOffset: 2 }
                        : undefined
                    }
                  >
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div className="row" style={{ gap: 10 }}>
                        {canEdit ? (
                          <span
                            className="dragHandle"
                            data-testid="structure-section-drag-handle"
                            draggable={canEdit && editingSectionLabelId !== section.id}
                            title="Drag to reorder section"
                            onDragStart={(e) => {
                              if (!canEdit) return;
                              if (editingSectionLabelId === section.id) return;
                              setDragPayload(e, { kind: "section", sectionId: section.id });
                            }}
                            onDragEnd={() => setTimeout(() => clearDragPayload(), 0)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            ⋮⋮
                          </span>
                        ) : null}
                        {editingSectionLabelId === section.id && canEdit ? (
                          <input
                            data-testid="section-label-input"
                            value={editingSectionLabelValue}
                            onChange={(e) => setEditingSectionLabelValue(e.target.value)}
                            autoFocus
                            style={{ width: 220 }}
                            onBlur={() => {
                              const next = sanitizeInlineText(editingSectionLabelValue);
                              setEditingSectionLabelId(null);
                              setEditingSectionLabelValue("");
                              if (!next) return;
                              updatePage((prev) =>
                                PageSchema.parse({
                                  ...prev,
                                  sections: prev.sections.map((s) => (s.id === section.id ? { ...s, label: next } : s)),
                                })
                              );
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingSectionLabelId(null);
                                setEditingSectionLabelValue("");
                                return;
                              }
                              if (e.key === "Enter") {
                                e.preventDefault();
                                (e.currentTarget as HTMLInputElement).blur();
                              }
                            }}
                          />
                        ) : (
                          <div
                            className="cardTitle"
                            data-testid="section-label"
                            onDoubleClick={() => {
                              if (!canEdit) return;
                              setEditingSectionLabelId(section.id);
                              setEditingSectionLabelValue(section.label);
                            }}
                            title={canEdit ? "Double-click to rename" : undefined}
                          >
                            {section.label}
                          </div>
                        )}
                        {!section.settings.visible ? <span className="badge">hidden</span> : null}
                      </div>
                      <div className="row">
                        <button className="btn" onClick={() => moveSection(section.id, -1)} disabled={!canEdit || idx === 0}>
                          ↑
                        </button>
                        <button
                          className="btn"
                          onClick={() => moveSection(section.id, 1)}
                          disabled={!canEdit || idx === page.sections.length - 1}
                        >
                          ↓
                        </button>
                        {selected?.componentId ? (
                          <button
                            className="btn"
                            onClick={() => {
                              if (!canEdit) return;
                              const fromComponentId = selected?.componentId;
                              if (!fromComponentId) return;
                              updatePage((prev) => {
                                const fromSection = prev.sections.find((s) => s.components.some((c) => c.id === fromComponentId));
                                const toSection = prev.sections.find((s) => s.id === section.id);
                                if (!fromSection || !toSection) return prev;
                                const actualFromSectionId = fromSection.id;
                                const nextSections = moveComponentByIndex({
                                  sections: prev.sections,
                                  fromSectionId: actualFromSectionId,
                                  fromComponentId,
                                  toSectionId: section.id,
                                  toIndex: toSection.components.length,
                                });
                                return PageSchema.parse({ ...prev, sections: nextSections });
                              });

                              setSelected({ sectionId: section.id, componentId: fromComponentId });
                            }}
                            disabled={!canEdit}
                            title="Move selected component to this section"
                          >
                            Move here
                          </button>
                        ) : null}
                        <button className="btn btnDanger" onClick={() => removeSection(section.id)} disabled={!canEdit}>
                          Remove
                        </button>
                        <button className="btn" onClick={() => setSelected({ sectionId: section.id })}>
                          Select
                        </button>
                      </div>
                    </div>
                    <div className="muted">{section.components.length} components</div>
                    <div
                      className="structureComponentDropZone"
                      data-testid="structure-component-dropzone"
                      data-section-id={section.id}
                      style={
                        dragOverComponentSectionId === section.id
                          ? { borderColor: "rgba(37, 99, 235, 0.6)", background: "rgba(37, 99, 235, 0.08)" }
                          : undefined
                      }
                      onDragOverCapture={(e) => {
                        if (!canEdit) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const payload = getDragPayload(e);
                        if (!payload || payload.kind !== "component") return;
                        setDragOverComponentSectionId(section.id);
                      }}
                      onDragEnterCapture={(e) => {
                        if (!canEdit) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const payload = getDragPayload(e);
                        if (!payload || payload.kind !== "component") return;
                        setDragOverComponentSectionId(section.id);
                      }}
                      onDragOver={(e) => {
                        if (!canEdit) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const payload = getDragPayload(e);
                        if (!payload || payload.kind !== "component") return;
                        setDragOverComponentSectionId(section.id);
                      }}
                      onDragEnter={(e) => {
                        if (!canEdit) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const payload = getDragPayload(e);
                        if (!payload || payload.kind !== "component") return;
                        setDragOverComponentSectionId(section.id);
                      }}
                      onDragLeave={(e) => {
                        const related = e.relatedTarget;
                        if (related && related instanceof Node && (e.currentTarget as HTMLElement).contains(related)) return;
                        setDragOverComponentSectionId((prev) => (prev === section.id ? null : prev));
                      }}
                      onDropCapture={(e) => {
                        if (!canEdit) return;
                        const payload = getDragPayload(e);
                        if (!payload || payload.kind !== "component") return;
                        e.preventDefault();
                        e.stopPropagation();
                        clearDragPayload();
                        setDragOverComponentSectionId(null);
                        updatePage((prev) => {
                          const fromSection = prev.sections.find((s) => s.components.some((c) => c.id === payload.componentId));
                          const toSection = prev.sections.find((s) => s.id === section.id);
                          if (!fromSection || !toSection) return prev;
                          const actualFromSectionId = fromSection.id;
                          const nextSections = moveComponentByIndex({
                            sections: prev.sections,
                            fromSectionId: actualFromSectionId,
                            fromComponentId: payload.componentId,
                            toSectionId: section.id,
                            toIndex: toSection.components.length,
                          });
                          return PageSchema.parse({ ...prev, sections: nextSections });
                        });

                        setSelected((prevSel) =>
                          prevSel?.componentId === payload.componentId ? { sectionId: section.id, componentId: payload.componentId } : prevSel
                        );
                      }}
                      onDrop={(e) => {
                        if (!canEdit) return;
                        const payload = getDragPayload(e);
                        if (!payload || payload.kind !== "component") return;
                        e.preventDefault();
                        e.stopPropagation();
                        clearDragPayload();
                        setDragOverComponentSectionId(null);
                        updatePage((prev) => {
                          const fromSection = prev.sections.find((s) => s.components.some((c) => c.id === payload.componentId));
                          const toSection = prev.sections.find((s) => s.id === section.id);
                          if (!fromSection || !toSection) return prev;
                          const actualFromSectionId = fromSection.id;
                          const nextSections = moveComponentByIndex({
                            sections: prev.sections,
                            fromSectionId: actualFromSectionId,
                            fromComponentId: payload.componentId,
                            toSectionId: section.id,
                            toIndex: toSection.components.length,
                          });
                          return PageSchema.parse({ ...prev, sections: nextSections });
                        });

                        setSelected((prevSel) =>
                          prevSel?.componentId === payload.componentId ? { sectionId: section.id, componentId: payload.componentId } : prevSel
                        );
                      }}
                    >
                      Drop component here
                    </div>
                  </div>
                ))}
              </div>

              {selectedSection ? (
                <Inspector
                  section={selectedSection}
                  component={selectedComponent}
                  imageAssets={imageAssets}
                  onUploadImageAssetOnly={uploadImageAssetOnly}
                  canEdit={canEdit}
                  onSelect={(componentId) => setSelected({ sectionId: selectedSection.id, componentId })}
                  onUpdate={(nextSection) =>
                    updatePage((prev) =>
                      PageSchema.parse({
                        ...prev,
                        sections: prev.sections.map((s) => (s.id === nextSection.id ? nextSection : s)),
                      })
                    )
                  }
                />
              ) : (
                <div className="muted">Select a section to edit its components.</div>
              )}
            </div>
          ) : (
            <div className="muted">Loading…</div>
          )}
        </div>
      </div>

      {page && imageEditor ? (
        <ImageEditorModal
          key={`${imageEditor.kind}:${imageEditor.assetId}`}
          title={imageEditor.kind === "asset" ? "Edit asset" : "Edit image in page"}
          srcUrl={() => {
            const asset = page.assets.find((a) => a.type === "image" && a.id === imageEditor.assetId);
            if (!asset || asset.type !== "image") return "";
            return `/projects/${encodeURIComponent(activeProjectId)}/assets/${encodeURIComponent(asset.filename)}`;
          }}
          initialAlt={() => {
            const asset = page.assets.find((a) => a.type === "image" && a.id === imageEditor.assetId);
            return asset && asset.type === "image" ? asset.alt : "";
          }}
          canEdit={canEdit}
          replaceAllUsages={imageEditor.replaceAllUsages}
          onChangeReplaceAllUsages={(next) =>
            setImageEditor((prev) => (prev ? { ...prev, replaceAllUsages: next } : prev))
          }
          onCancel={() => setImageEditor(null)}
          onSave={async (file) => {
            const oldAsset = page.assets.find((a) => a.type === "image" && a.id === imageEditor.assetId);
            const alt = oldAsset && oldAsset.type === "image" ? oldAsset.alt : "";
            const newAsset = await apiUploadImage(activeProjectId, file, alt);

            updatePage((prev) => {
              const nextAssets = [...prev.assets, newAsset];
              const nextSections = prev.sections.map((s) => ({
                ...s,
                components: s.components.map((c) => {
                  if (imageEditor.replaceAllUsages) {
                    if (c.type === "hero" && c.backgroundImageAssetId === imageEditor.assetId) return { ...c, backgroundImageAssetId: newAsset.id };
                    if (c.type === "image" && c.assetId === imageEditor.assetId) return { ...c, assetId: newAsset.id };
                    return c;
                  }

                  if (imageEditor.kind === "component" && s.id === imageEditor.sectionId) {
                    if (c.id === imageEditor.componentId && c.type === "image") return { ...c, assetId: newAsset.id };
                  }
                  return c;
                }),
              }));
              return PageSchema.parse({ ...prev, assets: nextAssets, sections: nextSections });
            });

            setImageEditor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PreviewComponent(props: {
  sectionId: string;
  component: Component;
  page: Page;
  projectId: string;
  isSelected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onUpdate: (next: Component) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUploadImageAssetOnly: (file: File) => Promise<{ id: string }>;
  onEditImage?: () => void;
  onMoveHere: (fromSectionId: string, fromComponentId: string, position: DropPosition) => void;
}) {
  const {
    sectionId,
    component,
    page,
    projectId,
    isSelected,
    canEdit,
    onSelect,
    onUpdate,
    onDelete,
    onDuplicate,
    onUploadImageAssetOnly,
    onEditImage,
    onMoveHere,
  } = props;
  const [isHovering, setIsHovering] = useState(false);
  const [dropHint, setDropHint] = useState<{ isOver: boolean; position: DropPosition }>({ isOver: false, position: "before" });
  const richTextRef = useRef<HTMLDivElement | null>(null);
  const showToolbar = (isSelected || isHovering) && canEdit;

  const wrapperClass = [
    "previewItem",
    isSelected ? "previewItemSelected" : "",
    dropHint.isOver ? (dropHint.position === "before" ? "previewItemDropBefore" : "previewItemDropAfter") : "",
  ]
    .filter(Boolean)
    .join(" ");

  const onDragOverTarget = (e: React.DragEvent) => {
    if (!canEdit) return;
    const payload = getDragPayload(e);
    if (!payload || payload.kind !== "component") return;
    e.preventDefault();
    autoScrollDuringDrag(e.currentTarget as HTMLElement, e.clientY);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position = computeDropPosition(rect, e.clientY);
    setDropHint((prev) => (prev.isOver && prev.position === position ? prev : { isOver: true, position }));
  };

  const onDropTarget = (e: React.DragEvent) => {
    if (!canEdit) return;
    const payload = getDragPayload(e);
    if (!payload || payload.kind !== "component") return;
    e.preventDefault();
    clearDragPayload();
    setDropHint((prev) => (prev.isOver ? { ...prev, isOver: false } : prev));
    if (payload.sectionId === sectionId && payload.componentId === component.id) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position = computeDropPosition(rect, e.clientY);
    onMoveHere(payload.sectionId, payload.componentId, position);
  };

  const dragProps = {
    draggable: canEdit && !isSelected,
    onDragStart: (e: React.DragEvent) => {
      if (!canEdit) return;
      setDragPayload(e, { kind: "component", sectionId, componentId: component.id });
    },
    onDragEnd: () => {
      // In some browsers/automation harnesses, `drop` can race with `dragend`.
      // Defer clearing so drop handlers can still read the in-memory payload if needed.
      setTimeout(() => clearDragPayload(), 0);
    },
    onDragOverCapture: onDragOverTarget,
    onDragLeave: (e: React.DragEvent) => {
      const related = e.relatedTarget;
      if (related && related instanceof Node && (e.currentTarget as HTMLElement).contains(related)) return;
      setDropHint((prev) => (prev.isOver ? { ...prev, isOver: false } : prev));
    },
    onDropCapture: onDropTarget,
    onMouseEnter: () => setIsHovering(true),
    onMouseLeave: () => setIsHovering(false),
  };
  if (component.type === "hero") {
    const outerStyle = computeBoxOuterStyle(component.style);
    const bgAsset =
      component.backgroundImageAssetId ? page.assets.find((a) => a.type === "image" && a.id === component.backgroundImageAssetId) : null;
    const heroStyle =
      bgAsset && bgAsset.type === "image"
        ? {
          backgroundImage: [
              "radial-gradient(900px 380px at 15% 15%, rgba(37, 99, 235, 0.10), transparent 62%)",
              "radial-gradient(900px 380px at 70% 20%, rgba(6, 182, 212, 0.08), transparent 62%)",
              "linear-gradient(180deg, rgba(255,255,255,0.86), rgba(255,255,255,0.92))",
              `url(/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(bgAsset.filename)})`,
            ].join(", "),
            backgroundSize: ["auto", "auto", "cover", "cover"].join(", "),
            backgroundPosition: ["0 0", "0 0", "center", "center"].join(", "),
            backgroundRepeat: ["no-repeat", "no-repeat", "no-repeat", "no-repeat"].join(", "),
          }
        : undefined;
    const innerStyle = computeBoxInnerStyle(component.style);
    const ctaInlineStyle = computeButtonInlineStyle(component.ctaStyle);
    return (
      <div
        className={wrapperClass}
        style={outerStyle}
        data-testid="preview-item"
        data-component-id={component.id}
        data-component-type={component.type}
        {...dragProps}
        onClick={() => onSelect()}
      >
        {showToolbar ? (
          <div className="previewToolbar" onClick={(e) => e.stopPropagation()}>
            <button className="btn" data-testid="preview-duplicate" onClick={() => onDuplicate()} disabled={!canEdit}>
              Duplicate
            </button>
            <button className="btn btnDanger" data-testid="preview-delete" onClick={() => onDelete()} disabled={!canEdit}>
              Delete
            </button>
          </div>
        ) : null}
        <div className="hero" style={{ ...heroStyle, ...innerStyle, pointerEvents: isSelected ? "auto" : "none" }}>
          <h1
            contentEditable={isSelected && canEdit}
            suppressContentEditableWarning
            onClick={(e) => (isSelected ? e.stopPropagation() : null)}
            onBlur={(e) => {
              if (!isSelected || !canEdit) return;
              const next = sanitizeInlineText(e.currentTarget.innerText);
              if (!next) return;
              onUpdate({ ...component, headline: next });
            }}
          >
            {component.headline}
          </h1>
          <p
            contentEditable={isSelected && canEdit}
            suppressContentEditableWarning
            onClick={(e) => (isSelected ? e.stopPropagation() : null)}
            onBlur={(e) => {
              if (!isSelected || !canEdit) return;
              const next = sanitizeInlineText(e.currentTarget.innerText);
              if (!next) return;
              onUpdate({ ...component, subheadline: next });
            }}
          >
            {component.subheadline}
          </p>
          <a className="cta" href={component.primaryCtaHref} style={ctaInlineStyle} onClick={(e) => e.preventDefault()}>
            <span
              contentEditable={isSelected && canEdit}
              suppressContentEditableWarning
              onClick={(e) => (isSelected ? e.stopPropagation() : null)}
              onBlur={(e) => {
                if (!isSelected || !canEdit) return;
                const next = sanitizeInlineText(e.currentTarget.innerText);
                if (!next) return;
                onUpdate({ ...component, primaryCtaText: next });
              }}
            >
              {component.primaryCtaText}
            </span>
          </a>
        </div>
      </div>
    );
  }

  if (component.type === "rich_text") {
    const outerStyle = computeBoxOuterStyle(component.style);
    const innerStyle = computeBoxInnerStyle(component.style);
    const safeHtml = sanitizeRichTextHtml(component.html);
    if (isSelected && canEdit) {
      const runCommand = (command: string) => {
        richTextRef.current?.focus();
        try {
          document.execCommand(command);
        } catch {
          // ignore
        }
      };
      return (
        <div
          className={wrapperClass}
          style={outerStyle}
          data-testid="preview-item"
          data-component-id={component.id}
          data-component-type={component.type}
          {...dragProps}
          onClick={() => onSelect()}
        >
          {showToolbar ? (
            <div className="previewToolbar" onClick={(e) => e.stopPropagation()}>
              <button className="btn" data-testid="preview-duplicate" onClick={() => onDuplicate()}>
                Duplicate
              </button>
              <button className="btn btnDanger" data-testid="preview-delete" onClick={() => onDelete()}>
                Delete
              </button>
            </div>
          ) : null}
          <div className="richTextFormatBar" data-testid="richtext-toolbar" onClick={(e) => e.stopPropagation()}>
            <button
              className="btn"
              data-testid="richtext-bold"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                runCommand("bold");
              }}
            >
              Bold
            </button>
            <button
              className="btn"
              data-testid="richtext-italic"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                runCommand("italic");
              }}
            >
              Italic
            </button>
            <button
              className="btn"
              data-testid="richtext-link"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const raw = window.prompt("Enter link URL (https://, mailto:, #anchor, /path)");
                const href = sanitizeRichTextHref(raw);
                if (!href) return;
                const container = richTextRef.current;
                if (!container) return;
                container.focus();
                insertRichTextLinkAtSelection(container, href);
              }}
            >
              Link
            </button>
            <button
              className="btn"
              data-testid="richtext-ul"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                runCommand("insertUnorderedList");
              }}
            >
              • List
            </button>
            <button
              className="btn"
              data-testid="richtext-ol"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                runCommand("insertOrderedList");
              }}
            >
              1. List
            </button>
            <button
              className="btn"
              data-testid="richtext-clear"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                runCommand("removeFormat");
                runCommand("unlink");
              }}
            >
              Clear
            </button>
          </div>
          <div
            key={`${component.id}-edit`}
            className="richText richTextEditable"
            style={innerStyle}
            ref={richTextRef}
            contentEditable
            suppressContentEditableWarning
            onClick={(e) => e.stopPropagation()}
            onPaste={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const rawHtml = e.clipboardData.getData("text/html");
              const rawText = e.clipboardData.getData("text/plain");
              const raw = rawHtml && rawHtml.trim().length ? rawHtml : plainTextToRichTextHtml(rawText);
              const clean = sanitizeRichTextHtml(raw);
              const container = richTextRef.current;
              if (!container) return;
              container.focus();
              try {
                document.execCommand("insertHTML", false, clean);
              } catch {
                // Fallback: append at end.
                container.innerHTML = sanitizeRichTextHtml(`${container.innerHTML}${clean}`);
              }
            }}
            onBlur={(e) => {
              const raw = e.currentTarget.innerHTML;
              const clean = sanitizeRichTextHtml(raw);
              e.currentTarget.innerHTML = clean;
              flushSync(() => {
                onUpdate({ ...component, html: clean });
              });
            }}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        </div>
      );
    }

    return (
      <div
        className={wrapperClass}
        style={outerStyle}
        data-testid="preview-item"
        data-component-id={component.id}
        data-component-type={component.type}
        {...dragProps}
        onClick={() => onSelect()}
      >
        {showToolbar ? (
          <div className="previewToolbar" onClick={(e) => e.stopPropagation()}>
            <button className="btn" data-testid="preview-duplicate" onClick={() => onDuplicate()} disabled={!canEdit}>
              Duplicate
            </button>
            <button className="btn btnDanger" data-testid="preview-delete" onClick={() => onDelete()} disabled={!canEdit}>
              Delete
            </button>
          </div>
        ) : null}
        <div
          key={`${component.id}-view`}
          className="richText"
          style={{ ...innerStyle, pointerEvents: "none" }}
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
    );
  }

  if (component.type === "contact_form") {
    const outerStyle = computeBoxOuterStyle(component.style);
    const innerStyle = computeBoxInnerStyle(component.style);
    const buttonJustify = computeButtonJustify(component.style.textAlign);
    const submitInlineStyle = computeButtonInlineStyle(component.submitStyle);
    return (
      <div
        className={wrapperClass}
        style={outerStyle}
        data-testid="preview-item"
        data-component-id={component.id}
        data-component-type={component.type}
        {...dragProps}
        onClick={() => onSelect()}
      >
        {showToolbar ? (
          <div className="previewToolbar" onClick={(e) => e.stopPropagation()}>
            <button className="btn" data-testid="preview-duplicate" onClick={() => onDuplicate()} disabled={!canEdit}>
              Duplicate
            </button>
            <button className="btn btnDanger" data-testid="preview-delete" onClick={() => onDelete()} disabled={!canEdit}>
              Delete
            </button>
          </div>
        ) : null}
        <div className="contactForm" id="contact" style={{ ...innerStyle, pointerEvents: isSelected ? "auto" : "none" }}>
          <h3
            contentEditable={isSelected && canEdit}
            suppressContentEditableWarning
            onClick={(e) => (isSelected ? e.stopPropagation() : null)}
            onBlur={(e) => {
              if (!isSelected || !canEdit) return;
              const next = sanitizeInlineText(e.currentTarget.innerText);
              if (!next) return;
              onUpdate({ ...component, headline: next });
            }}
          >
            {component.headline}
          </h3>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="field">
              <label>Name</label>
              <input />
            </div>
            <div className="field">
              <label>Email</label>
              <input />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea rows={4} />
            </div>
            <button
              className="btn btnPrimary"
              type="submit"
              onClick={(e) => e.preventDefault()}
              style={{ justifySelf: buttonJustify, ...submitInlineStyle }}
            >
              <span
                contentEditable={isSelected && canEdit}
                suppressContentEditableWarning
                onClick={(e) => (isSelected ? e.stopPropagation() : null)}
                onBlur={(e) => {
                  if (!isSelected || !canEdit) return;
                  const next = sanitizeInlineText(e.currentTarget.innerText);
                  if (!next) return;
                  onUpdate({ ...component, submitLabel: next });
                }}
              >
                {component.submitLabel}
              </span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (component.type === "image") {
    const asset = page.assets.find((a) => a.type === "image" && a.id === component.assetId);
    if (!asset || asset.type !== "image") return null;
    const align = component.style.align ?? "center";
    const blockStyle: React.CSSProperties = {
      maxWidth: component.style.maxWidth ?? undefined,
      margin:
        align === "center" ? "0 auto" : align === "left" ? "0 auto 0 0" : align === "right" ? "0 0 0 auto" : undefined,
    };
    const focalActive = component.style.focalX !== null || component.style.focalY !== null;
    const focalX = component.style.focalX ?? 50;
    const focalY = component.style.focalY ?? 50;
    const imgStyle: React.CSSProperties = {
      borderRadius: component.style.radius ?? undefined,
      objectFit: component.style.fit ?? undefined,
      objectPosition: focalActive ? `${focalX}% ${focalY}%` : undefined,
    };
    return (
      <div
        className={wrapperClass}
        data-testid="preview-item"
        data-component-id={component.id}
        data-component-type={component.type}
        {...dragProps}
        onClick={() => onSelect()}
      >
        {showToolbar ? (
          <div className="previewToolbar" onClick={(e) => e.stopPropagation()}>
            <label className="btn" data-testid="preview-image-replace" style={!canEdit ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
              Replace
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                data-testid="preview-image-replace-input"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (!file) return;
                  const next = await onUploadImageAssetOnly(file);
                  onUpdate({ ...component, assetId: next.id });
                }}
              />
            </label>
            <button className="btn" data-testid="preview-image-edit" onClick={() => onEditImage?.()} disabled={!canEdit || !onEditImage}>
              Edit
            </button>
            <button className="btn" data-testid="preview-duplicate" onClick={() => onDuplicate()} disabled={!canEdit}>
              Duplicate
            </button>
            <button className="btn btnDanger" data-testid="preview-delete" onClick={() => onDelete()} disabled={!canEdit}>
              Delete
            </button>
          </div>
        ) : null}
        <div className="imageBlock" style={{ ...blockStyle, pointerEvents: isSelected ? "auto" : "none" }}>
          <div className="imageMedia">
            <img
              src={`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.filename)}`}
              alt={asset.alt}
              style={imgStyle}
              onClick={(e) => {
                if (!isSelected || !canEdit) return;
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
                const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
                onUpdate({ ...component, style: { ...component.style, focalX: Math.round(x), focalY: Math.round(y) } });
              }}
            />
            {isSelected && canEdit ? (
              <div
                className={focalActive ? "imageFocalDot" : "imageFocalDot imageFocalDotAuto"}
                style={{ left: `${focalX}%`, top: `${focalY}%` }}
                aria-hidden
              />
            ) : null}
          </div>
          {isSelected && canEdit ? (
            <div
              className="imageCaption"
              contentEditable
              suppressContentEditableWarning
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const raw = sanitizeInlineText(e.currentTarget.innerText);
                const placeholder = "Add a caption…";
                const next = component.caption ? raw : raw === placeholder ? "" : raw;
                onUpdate({ ...component, caption: next });
              }}
            >
              {component.caption || "Add a caption…"}
            </div>
          ) : component.caption ? (
            <div className="imageCaption">{component.caption}</div>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}

function PreviewDropZone(props: {
  sectionId: string;
  onMoveToEnd: (fromSectionId: string, fromComponentId: string) => void;
}) {
  const { sectionId, onMoveToEnd } = props;
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      className="previewDropZone"
      data-testid="preview-dropzone"
      data-section-id={sectionId}
      style={isOver ? { borderColor: "rgba(124, 92, 255, 0.8)", background: "rgba(124, 92, 255, 0.10)" } : undefined}
      onDragOver={(e) => {
        const payload = getDragPayload(e);
        if (!payload || payload.kind !== "component") return;
        e.preventDefault();
        autoScrollDuringDrag(e.currentTarget as HTMLElement, e.clientY);
        setIsOver(true);
      }}
      onDragLeave={(e) => {
        const related = e.relatedTarget;
        if (related && related instanceof Node && (e.currentTarget as HTMLElement).contains(related)) return;
        setIsOver(false);
      }}
      onDrop={(e) => {
        const payload = getDragPayload(e);
        if (!payload || payload.kind !== "component") return;
        e.preventDefault();
        clearDragPayload();
        setIsOver(false);
        onMoveToEnd(payload.sectionId, payload.componentId);
      }}
    >
      Drop here to append
    </div>
  );
}

function Inspector(props: {
  section: Section;
  component: Component | null;
  imageAssets: Array<{ id: string; filename: string; alt: string }>;
  onUploadImageAssetOnly: (file: File) => Promise<{ id: string }>;
  canEdit: boolean;
  onSelect: (componentId: string) => void;
  onUpdate: (next: Section) => void;
}) {
  const { section, component, imageAssets, onUploadImageAssetOnly, canEdit, onSelect, onUpdate } = props;
  const [selectedImageAssetId, setSelectedImageAssetId] = useState<string>(imageAssets[0]?.id ?? "");
  const [dragOverComponentId, setDragOverComponentId] = useState<string | null>(null);

  useEffect(() => {
    if (imageAssets.length === 0) {
      setSelectedImageAssetId("");
      return;
    }
    if (!selectedImageAssetId || !imageAssets.some((a) => a.id === selectedImageAssetId)) {
      const first = imageAssets[0];
      if (first) setSelectedImageAssetId(first.id);
    }
  }, [imageAssets, selectedImageAssetId]);

  const add = useCallback(
    (type: Component["type"]) => {
      if (!canEdit) return;
      const next: Section = {
        ...section,
        components: [...section.components, createComponent(type)],
      };
      onUpdate(next);
    },
    [canEdit, onUpdate, section]
  );

  const addImage = useCallback(() => {
    if (!canEdit) return;
    if (!selectedImageAssetId) return;
    const next: Section = {
      ...section,
      components: [...section.components, createImageComponent(selectedImageAssetId)],
    };
    onUpdate(next);
  }, [canEdit, onUpdate, section, selectedImageAssetId]);

  const moveComponent = useCallback(
    (componentId: string, delta: -1 | 1) => {
      if (!canEdit) return;
      const index = section.components.findIndex((c) => c.id === componentId);
      if (index < 0) return;
      const next: Section = {
        ...section,
        components: moveInArray(section.components, index, index + delta),
      };
      onUpdate(next);
    },
    [canEdit, onUpdate, section]
  );

  const removeComponent = useCallback(
    (componentId: string) => {
      if (!canEdit) return;
      const next: Section = {
        ...section,
        components: section.components.filter((c) => c.id !== componentId),
      };
      onUpdate(next);
    },
    [canEdit, onUpdate, section]
  );

  return (
    <div className="card">
      <div className="cardTitle">Inspector</div>
      <div className="stack">
        <div className="muted">Section: {section.label}</div>

        <div className="card">
          <div className="cardTitle">Section style</div>
          <div className="stack">
            <div className="field">
              <label>Background</label>
              <div className="row">
                <input
                  data-testid="section-bg"
                  type="color"
                  value={section.style.background ?? "#000000"}
                  disabled={!canEdit}
                  onChange={(e) =>
                    onUpdate({
                      ...section,
                      style: { ...section.style, background: e.target.value, backgroundGradient: null },
                    })
                  }
                />
                <button
                  className="btn"
                  onClick={() => onUpdate({ ...section, style: { ...section.style, background: null, backgroundGradient: null } })}
                  disabled={!canEdit}
                >
                  Clear
                </button>
              </div>

              <label className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
                <span className="muted">Gradient</span>
                <input
                  data-testid="section-bg-gradient-enabled"
                  type="checkbox"
                  checked={section.style.backgroundGradient !== null}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    onUpdate({
                      ...section,
                      style: {
                        ...section.style,
                        background: enabled ? null : section.style.background,
                        backgroundGradient: enabled ? { from: "#ffffff", to: "#e2e8f0", angle: 135 } : null,
                      },
                    });
                  }}
                />
              </label>

              {section.style.backgroundGradient ? (
                <div className="stack" style={{ marginTop: 10 }}>
                  <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                    <span className="muted">From</span>
                    <input
                      data-testid="section-bg-gradient-from"
                      type="color"
                      value={section.style.backgroundGradient.from ?? "#ffffff"}
                      disabled={!canEdit}
                      onChange={(e) =>
                        onUpdate({
                          ...section,
                          style: {
                            ...section.style,
                            background: null,
                            backgroundGradient: { ...section.style.backgroundGradient!, from: e.target.value },
                          },
                        })
                      }
                    />
                  </div>
                  <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                    <span className="muted">To</span>
                    <input
                      data-testid="section-bg-gradient-to"
                      type="color"
                      value={section.style.backgroundGradient.to ?? "#e2e8f0"}
                      disabled={!canEdit}
                      onChange={(e) =>
                        onUpdate({
                          ...section,
                          style: {
                            ...section.style,
                            background: null,
                            backgroundGradient: { ...section.style.backgroundGradient!, to: e.target.value },
                          },
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Angle</label>
                    <div className="row">
                      <input
                        data-testid="section-bg-gradient-angle"
                        type="range"
                        min={0}
                        max={360}
                        value={section.style.backgroundGradient.angle ?? 135}
                        disabled={!canEdit}
                        onChange={(e) =>
                          onUpdate({
                            ...section,
                            style: {
                              ...section.style,
                              background: null,
                              backgroundGradient: { ...section.style.backgroundGradient!, angle: Number(e.target.value) },
                            },
                          })
                        }
                        style={{ flex: 1 }}
                      />
                      <span className="badge">{(section.style.backgroundGradient.angle ?? 135).toFixed(0)}°</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="field">
              <label>Padding</label>
              <div className="row">
                <input
                  data-testid="section-padding"
                  type="range"
                  min={0}
                  max={96}
                  value={section.style.padding ?? 0}
                  disabled={!canEdit}
                  onChange={(e) =>
                    onUpdate({
                      ...section,
                      style: { ...section.style, padding: Number(e.target.value) },
                    })
                  }
                  style={{ flex: 1 }}
                />
                <span className="badge">{section.style.padding ?? 0}px</span>
                <button className="btn" onClick={() => onUpdate({ ...section, style: { ...section.style, padding: null } })} disabled={!canEdit}>
                  Auto
                </button>
              </div>
            </div>

            <div className="field">
              <label>Max width</label>
              <div className="row">
                <select
                  data-testid="section-maxwidth"
                  value={section.style.maxWidth ?? ""}
                  disabled={!canEdit}
                  onChange={(e) =>
                    onUpdate({
                      ...section,
                      style: {
                        ...section.style,
                        maxWidth: (() => {
                          if (e.target.value === "") return null;
                          const n = Number(e.target.value);
                          return SECTION_MAX_WIDTHS.includes(n as (typeof SECTION_MAX_WIDTHS)[number])
                            ? (n as (typeof SECTION_MAX_WIDTHS)[number])
                            : null;
                        })(),
                      },
                    })
                  }
                >
                  <option value="">(auto)</option>
                  {SECTION_MAX_WIDTHS.map((w) => (
                    <option key={w} value={String(w)}>
                      {w}
                    </option>
                  ))}
                </select>
                <button className="btn" onClick={() => onUpdate({ ...section, style: { ...section.style, maxWidth: null } })} disabled={!canEdit}>
                  Auto
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="cardTitle">Section settings</div>
          <div className="stack">
            <label className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Visible</span>
              <input
                data-testid="section-visible"
                type="checkbox"
                checked={section.settings.visible}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({
                    ...section,
                    settings: { ...section.settings, visible: e.target.checked },
                  })
                }
              />
            </label>

            <div className="field">
              <label>Layout</label>
              <select
                data-testid="section-layout"
                value={section.settings.layout}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({
                    ...section,
                    settings: {
                      ...section.settings,
                      layout: SECTION_LAYOUTS.includes(e.target.value as (typeof SECTION_LAYOUTS)[number])
                        ? (e.target.value as (typeof SECTION_LAYOUTS)[number])
                        : "stack",
                    },
                  })
                }
              >
                {SECTION_LAYOUTS.map((layout) => (
                  <option key={layout} value={layout}>
                    {layout}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Gap</label>
              <div className="row">
                <input
                  data-testid="section-gap"
                  type="range"
                  min={0}
                  max={48}
                  value={section.settings.gap ?? 12}
                  disabled={!canEdit}
                  onChange={(e) =>
                    onUpdate({
                      ...section,
                      settings: { ...section.settings, gap: Number(e.target.value) },
                    })
                  }
                  style={{ flex: 1 }}
                />
                <span className="badge">{section.settings.gap ?? 12}px</span>
                <button className="btn" onClick={() => onUpdate({ ...section, settings: { ...section.settings, gap: null } })} disabled={!canEdit}>
                  Auto
                </button>
              </div>
            </div>

            <div className="field">
              <label>Grid columns</label>
              <div className="row">
                <select
                  data-testid="section-grid-cols"
                  value={section.settings.gridColumns ?? ""}
                  disabled={!canEdit || section.settings.layout !== "grid"}
                  onChange={(e) =>
                    onUpdate({
                      ...section,
                      settings: {
                        ...section.settings,
                        gridColumns: (() => {
                          if (e.target.value === "") return null;
                          const n = Number(e.target.value);
                          return SECTION_GRID_COLUMNS.includes(n as (typeof SECTION_GRID_COLUMNS)[number])
                            ? (n as (typeof SECTION_GRID_COLUMNS)[number])
                            : null;
                        })(),
                      },
                    })
                  }
                >
                  <option value="">(auto)</option>
                  {SECTION_GRID_COLUMNS.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  className="btn"
                  onClick={() => onUpdate({ ...section, settings: { ...section.settings, gridColumns: null } })}
                  disabled={!canEdit || section.settings.layout !== "grid"}
                >
                  Auto
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => add("hero")} disabled={!canEdit}>
            + Hero
          </button>
          <button className="btn" onClick={() => add("rich_text")} disabled={!canEdit}>
            + Text
          </button>
          <button className="btn" onClick={() => add("contact_form")} disabled={!canEdit}>
            + Form
          </button>
        </div>

        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Image asset</label>
            <select value={selectedImageAssetId} onChange={(e) => setSelectedImageAssetId(e.target.value)} disabled={!canEdit}>
              <option value="">(none)</option>
              {imageAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.filename}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" onClick={addImage} disabled={!canEdit || !selectedImageAssetId}>
            + Image
          </button>
        </div>

        <div className="list">
          {section.components.map((c, idx) => (
            <div
              key={c.id}
              className="row"
              data-testid="inspector-component-row"
              data-component-id={c.id}
              data-component-type={c.type}
              draggable={canEdit}
              onDragStart={(e) => {
                if (!canEdit) return;
                setDragPayload(e, { kind: "component", sectionId: section.id, componentId: c.id });
              }}
              onDragEnd={() => {
                // In some browsers/automation harnesses, `drop` can race with `dragend`.
                // Defer clearing so drop handlers can still read the in-memory payload if needed.
                setTimeout(() => clearDragPayload(), 50);
              }}
              style={
                dragOverComponentId === c.id
                  ? { justifyContent: "space-between", outline: "2px solid rgba(124, 92, 255, 0.55)", outlineOffset: 2, borderRadius: 12, padding: 4 }
                  : { justifyContent: "space-between" }
              }
              onDragOver={(e) => {
                if (!canEdit) return;
                const payload = getDragPayload(e);
                if (!payload || payload.kind !== "component") return;
                if (payload.sectionId !== section.id) return;
                e.preventDefault();
                setDragOverComponentId(c.id);
              }}
              onDragLeave={() => setDragOverComponentId((prev) => (prev === c.id ? null : prev))}
              onDrop={(e) => {
                if (!canEdit) return;
                const payload = getDragPayload(e);
                if (!payload || payload.kind !== "component") return;
                if (payload.sectionId !== section.id) return;
                e.preventDefault();
                clearDragPayload();
                setDragOverComponentId(null);
                if (payload.componentId === c.id) return;
                const fromIndex = section.components.findIndex((x) => x.id === payload.componentId);
                const toIndex = section.components.findIndex((x) => x.id === c.id);
                if (fromIndex < 0 || toIndex < 0) return;
                onUpdate({ ...section, components: moveInArray(section.components, fromIndex, toIndex) });
              }}
            >
              <div className="row" style={{ gap: 8 }}>
                <span
                  className="dragHandle"
                  data-testid="inspector-component-drag-handle"
                  data-component-id={c.id}
                  draggable={canEdit}
                  title="Drag to reorder"
                  onDragStart={(e) => {
                    if (!canEdit) return;
                    setDragPayload(e, { kind: "component", sectionId: section.id, componentId: c.id });
                  }}
                  onDragEnd={() => {
                    // In some browsers/automation harnesses, `drop` can race with `dragend`.
                    // Defer clearing so drop handlers can still read the in-memory payload if needed.
                    setTimeout(() => clearDragPayload(), 50);
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  ⋮⋮
                </span>
                <button className="btn" onClick={() => onSelect(c.id)}>
                  {c.type}
                </button>
              </div>
              <div className="row">
                <button className="btn" onClick={() => moveComponent(c.id, -1)} disabled={!canEdit || idx === 0}>
                  ↑
                </button>
                <button
                  className="btn"
                  onClick={() => moveComponent(c.id, 1)}
                  disabled={!canEdit || idx === section.components.length - 1}
                >
                  ↓
                </button>
                <button className="btn btnDanger" onClick={() => removeComponent(c.id)} disabled={!canEdit}>
                  Remove
                </button>
                <span className="badge">{c.id.slice(0, 8)}</span>
              </div>
            </div>
          ))}
        </div>

        {component ? (
          <ComponentFields
            component={component}
            imageAssets={imageAssets}
            onUploadImageAssetOnly={onUploadImageAssetOnly}
            canEdit={canEdit}
            onUpdate={(next) => updateComponent(section, next, onUpdate)}
          />
        ) : null}
      </div>
    </div>
  );
}

function updateComponent(section: Section, next: Component, onUpdate: (next: Section) => void) {
  const updated: Section = {
    ...section,
    components: section.components.map((c) => (c.id === next.id ? next : c)),
  };
  onUpdate(updated);
}

function ComponentFields(props: {
  component: Component;
  imageAssets: Array<{ id: string; filename: string; alt: string }>;
  onUploadImageAssetOnly: (file: File) => Promise<{ id: string }>;
  canEdit: boolean;
  onUpdate: (next: Component) => void;
}) {
  const { component, imageAssets, onUploadImageAssetOnly, canEdit, onUpdate } = props;

  const renderBoxStyleCard = (style: ComponentBoxStyle, setStyle: (next: ComponentBoxStyle) => void) => {
    const alignValue = style.textAlign ?? style.blockAlign ?? "";
    return (
      <div className="card">
        <div className="cardTitle">Style</div>
        <div className="stack">
          <div className="field">
            <label>Align</label>
            <select
              data-testid="component-style-align"
              value={alignValue}
              disabled={!canEdit}
              onChange={(e) => {
                const next =
                  e.target.value === ""
                    ? null
                    : e.target.value === "left"
                      ? "left"
                      : e.target.value === "right"
                        ? "right"
                        : "center";
                setStyle({ ...style, blockAlign: next, textAlign: next });
              }}
            >
              <option value="">(auto)</option>
              {TEXT_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Max width</label>
            <div className="row">
              <select
                data-testid="component-style-maxwidth"
                value={style.maxWidth ?? ""}
                disabled={!canEdit}
                onChange={(e) =>
                  setStyle({
                    ...style,
                    maxWidth:
                      e.target.value === ""
                        ? null
                        : e.target.value === "480"
                          ? 480
                          : e.target.value === "720"
                            ? 720
                            : e.target.value === "980"
                              ? 980
                              : null,
                  })
                }
              >
                <option value="">(auto)</option>
                {COMPONENT_MAX_WIDTHS.map((w) => (
                  <option key={w} value={String(w)}>
                    {w}
                  </option>
                ))}
              </select>
              <button className="btn" disabled={!canEdit} onClick={() => setStyle({ ...style, maxWidth: null })}>
                Auto
              </button>
            </div>
          </div>

          <div className="field">
            <label>Padding</label>
            <div className="row">
              <input
                data-testid="component-style-padding"
                type="range"
                min={0}
                max={96}
                value={style.padding ?? 0}
                disabled={!canEdit}
                onChange={(e) => setStyle({ ...style, padding: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <span className="badge">{style.padding ?? 0}px</span>
              <button className="btn" disabled={!canEdit} onClick={() => setStyle({ ...style, padding: null })}>
                Auto
              </button>
            </div>
          </div>

          <div className="field">
            <label>Background</label>
            <div className="row">
              <input
                data-testid="component-style-bg"
                type="color"
                value={style.backgroundColor ?? "#000000"}
                disabled={!canEdit}
                onChange={(e) => setStyle({ ...style, backgroundColor: e.target.value, backgroundGradient: null })}
              />
              <button className="btn" disabled={!canEdit} onClick={() => setStyle({ ...style, backgroundColor: null })}>
                Clear
              </button>
            </div>

            <label className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
              <span className="muted">Gradient</span>
              <input
                data-testid="component-style-bg-gradient-enabled"
                type="checkbox"
                checked={style.backgroundGradient !== null}
                disabled={!canEdit}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setStyle({
                    ...style,
                    backgroundColor: enabled ? null : style.backgroundColor,
                    backgroundGradient: enabled ? { from: "#ffffff", to: "#e2e8f0", angle: 135 } : null,
                  });
                }}
              />
            </label>

            {style.backgroundGradient ? (
              <div className="stack" style={{ marginTop: 10 }}>
                <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                  <span className="muted">From</span>
                  <input
                    data-testid="component-style-bg-gradient-from"
                    type="color"
                    value={style.backgroundGradient.from ?? "#ffffff"}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setStyle({
                        ...style,
                        backgroundColor: null,
                        backgroundGradient: { ...style.backgroundGradient!, from: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                  <span className="muted">To</span>
                  <input
                    data-testid="component-style-bg-gradient-to"
                    type="color"
                    value={style.backgroundGradient.to ?? "#e2e8f0"}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setStyle({
                        ...style,
                        backgroundColor: null,
                        backgroundGradient: { ...style.backgroundGradient!, to: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Angle</label>
                  <div className="row">
                    <input
                      data-testid="component-style-bg-gradient-angle"
                      type="range"
                      min={0}
                      max={360}
                      value={style.backgroundGradient.angle ?? 135}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setStyle({
                          ...style,
                          backgroundColor: null,
                          backgroundGradient: { ...style.backgroundGradient!, angle: Number(e.target.value) },
                        })
                      }
                      style={{ flex: 1 }}
                    />
                    <span className="badge">{(style.backgroundGradient.angle ?? 135).toFixed(0)}°</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  if (component.type === "hero") {
    return (
      <div className="stack">
        <div className="field">
          <label>Headline</label>
          <input
            value={component.headline}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...component, headline: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Background image</label>
          <select
            value={component.backgroundImageAssetId ?? ""}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...component, backgroundImageAssetId: e.target.value ? e.target.value : null })}
          >
            <option value="">(none)</option>
            {imageAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.filename}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Subheadline</label>
          <textarea
            rows={3}
            value={component.subheadline}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...component, subheadline: e.target.value })}
          />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>CTA text</label>
            <input
              value={component.primaryCtaText}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ ...component, primaryCtaText: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>CTA href</label>
            <input
              value={component.primaryCtaHref}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ ...component, primaryCtaHref: e.target.value })}
            />
          </div>
        </div>

        <div className="card">
          <div className="cardTitle">CTA button</div>
          <div className="stack">
            <div className="field">
              <label>Variant</label>
              <select
                data-testid="hero-cta-variant"
                value={component.ctaStyle.variant ?? ""}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({
                    ...component,
                    ctaStyle: {
                      ...component.ctaStyle,
                      variant: e.target.value === "" ? null : e.target.value === "outline" ? "outline" : "filled",
                    },
                  })
                }
              >
                <option value="">(auto)</option>
                {BUTTON_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Background</label>
              <div className="row">
                <input
                  data-testid="hero-cta-bg"
                  type="color"
                  value={component.ctaStyle.bgColor ?? "#000000"}
                  disabled={!canEdit}
                  onChange={(e) => onUpdate({ ...component, ctaStyle: { ...component.ctaStyle, bgColor: e.target.value } })}
                />
                <button className="btn" disabled={!canEdit} onClick={() => onUpdate({ ...component, ctaStyle: { ...component.ctaStyle, bgColor: null } })}>
                  Clear
                </button>
              </div>
            </div>

            <div className="field">
              <label>Text</label>
              <div className="row">
                <input
                  data-testid="hero-cta-text"
                  type="color"
                  value={component.ctaStyle.textColor ?? "#ffffff"}
                  disabled={!canEdit}
                  onChange={(e) => onUpdate({ ...component, ctaStyle: { ...component.ctaStyle, textColor: e.target.value } })}
                />
                <button
                  className="btn"
                  disabled={!canEdit}
                  onClick={() => onUpdate({ ...component, ctaStyle: { ...component.ctaStyle, textColor: null } })}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="field">
              <label>Border</label>
              <div className="row">
                <input
                  data-testid="hero-cta-border"
                  type="color"
                  value={component.ctaStyle.borderColor ?? "#000000"}
                  disabled={!canEdit}
                  onChange={(e) => onUpdate({ ...component, ctaStyle: { ...component.ctaStyle, borderColor: e.target.value } })}
                />
                <button
                  className="btn"
                  disabled={!canEdit}
                  onClick={() => onUpdate({ ...component, ctaStyle: { ...component.ctaStyle, borderColor: null } })}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="field">
              <label>Radius</label>
              <div className="row">
                <input
                  data-testid="hero-cta-radius"
                  type="range"
                  min={0}
                  max={28}
                  value={component.ctaStyle.radius ?? 10}
                  disabled={!canEdit}
                  onChange={(e) => onUpdate({ ...component, ctaStyle: { ...component.ctaStyle, radius: Number(e.target.value) } })}
                  style={{ flex: 1 }}
                />
                <span className="badge">{component.ctaStyle.radius ?? 10}px</span>
                <button className="btn" disabled={!canEdit} onClick={() => onUpdate({ ...component, ctaStyle: { ...component.ctaStyle, radius: null } })}>
                  Auto
                </button>
              </div>
            </div>

            <button
              className="btn"
              data-testid="hero-cta-clear"
              disabled={!canEdit}
              onClick={() =>
                onUpdate({ ...component, ctaStyle: { ...component.ctaStyle, variant: null, bgColor: null, textColor: null, borderColor: null, radius: null } })
              }
            >
              Clear button styles
            </button>
          </div>
        </div>

        {renderBoxStyleCard(component.style, (style) => onUpdate({ ...component, style }))}
      </div>
    );
  }

  if (component.type === "rich_text") {
    return (
      <div className="stack">
        <div className="field">
          <label>HTML</label>
          <textarea
            rows={8}
            value={component.html}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...component, html: e.target.value })}
          />
          <div className="muted">
            Tip: use the inline editor in Preview (with the formatting toolbar). This textarea is for advanced raw HTML and is sanitized on save/export.
          </div>
        </div>

        {renderBoxStyleCard(component.style, (style) => onUpdate({ ...component, style }))}
      </div>
    );
  }

  if (component.type === "contact_form") {
    return (
      <div className="stack">
        <div className="field">
          <label>Headline</label>
          <input
            value={component.headline}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...component, headline: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Submit label</label>
          <input
            value={component.submitLabel}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...component, submitLabel: e.target.value })}
          />
        </div>

        <div className="card">
          <div className="cardTitle">Submit button</div>
          <div className="stack">
            <div className="field">
              <label>Variant</label>
              <select
                data-testid="contact-submit-variant"
                value={component.submitStyle.variant ?? ""}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({
                    ...component,
                    submitStyle: {
                      ...component.submitStyle,
                      variant: e.target.value === "" ? null : e.target.value === "outline" ? "outline" : "filled",
                    },
                  })
                }
              >
                <option value="">(auto)</option>
                {BUTTON_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Background</label>
              <div className="row">
                <input
                  data-testid="contact-submit-bg"
                  type="color"
                  value={component.submitStyle.bgColor ?? "#000000"}
                  disabled={!canEdit}
                  onChange={(e) => onUpdate({ ...component, submitStyle: { ...component.submitStyle, bgColor: e.target.value } })}
                />
                <button className="btn" disabled={!canEdit} onClick={() => onUpdate({ ...component, submitStyle: { ...component.submitStyle, bgColor: null } })}>
                  Clear
                </button>
              </div>
            </div>

            <div className="field">
              <label>Text</label>
              <div className="row">
                <input
                  data-testid="contact-submit-text"
                  type="color"
                  value={component.submitStyle.textColor ?? "#ffffff"}
                  disabled={!canEdit}
                  onChange={(e) => onUpdate({ ...component, submitStyle: { ...component.submitStyle, textColor: e.target.value } })}
                />
                <button
                  className="btn"
                  disabled={!canEdit}
                  onClick={() => onUpdate({ ...component, submitStyle: { ...component.submitStyle, textColor: null } })}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="field">
              <label>Border</label>
              <div className="row">
                <input
                  data-testid="contact-submit-border"
                  type="color"
                  value={component.submitStyle.borderColor ?? "#000000"}
                  disabled={!canEdit}
                  onChange={(e) => onUpdate({ ...component, submitStyle: { ...component.submitStyle, borderColor: e.target.value } })}
                />
                <button
                  className="btn"
                  disabled={!canEdit}
                  onClick={() => onUpdate({ ...component, submitStyle: { ...component.submitStyle, borderColor: null } })}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="field">
              <label>Radius</label>
              <div className="row">
                <input
                  data-testid="contact-submit-radius"
                  type="range"
                  min={0}
                  max={28}
                  value={component.submitStyle.radius ?? 10}
                  disabled={!canEdit}
                  onChange={(e) => onUpdate({ ...component, submitStyle: { ...component.submitStyle, radius: Number(e.target.value) } })}
                  style={{ flex: 1 }}
                />
                <span className="badge">{component.submitStyle.radius ?? 10}px</span>
                <button className="btn" disabled={!canEdit} onClick={() => onUpdate({ ...component, submitStyle: { ...component.submitStyle, radius: null } })}>
                  Auto
                </button>
              </div>
            </div>

            <button
              className="btn"
              data-testid="contact-submit-clear"
              disabled={!canEdit}
              onClick={() =>
                onUpdate({
                  ...component,
                  submitStyle: { ...component.submitStyle, variant: null, bgColor: null, textColor: null, borderColor: null, radius: null },
                })
              }
            >
              Clear button styles
            </button>
          </div>
        </div>

        {renderBoxStyleCard(component.style, (style) => onUpdate({ ...component, style }))}
      </div>
    );
  }

  if (component.type === "image") {
    return (
      <div className="stack">
        <div className="card">
          <div className="cardTitle">Image style</div>
          <div className="stack">
            <div className="field">
              <label>Fit</label>
              <select
                data-testid="image-style-fit"
                value={component.style.fit ?? ""}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({
                    ...component,
                    style: { ...component.style, fit: e.target.value === "" ? null : e.target.value === "contain" ? "contain" : "cover" },
                  })
                }
              >
                <option value="">(auto)</option>
                <option value="cover">cover</option>
                <option value="contain">contain</option>
              </select>
            </div>

            <div className="field">
              <label>Align</label>
              <select
                data-testid="image-style-align"
                value={component.style.align ?? ""}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({
                    ...component,
                    style: {
                      ...component.style,
                      align:
                        e.target.value === "" ? null : e.target.value === "left" ? "left" : e.target.value === "right" ? "right" : "center",
                    },
                  })
                }
              >
                <option value="">(auto)</option>
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
            </div>

            <div className="field">
              <label>Focal point</label>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    X
                  </div>
                  <input
                    data-testid="image-style-focalx"
                    type="range"
                    min={0}
                    max={100}
                    value={component.style.focalX ?? 50}
                    disabled={!canEdit}
                    onChange={(e) => onUpdate({ ...component, style: { ...component.style, focalX: Number(e.target.value) } })}
                    style={{ width: "100%" }}
                  />
                </div>
                <span className="badge">{(component.style.focalX ?? 50).toFixed(0)}%</span>
              </div>
              <div className="row" style={{ gap: 10, alignItems: "center", marginTop: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    Y
                  </div>
                  <input
                    data-testid="image-style-focaly"
                    type="range"
                    min={0}
                    max={100}
                    value={component.style.focalY ?? 50}
                    disabled={!canEdit}
                    onChange={(e) => onUpdate({ ...component, style: { ...component.style, focalY: Number(e.target.value) } })}
                    style={{ width: "100%" }}
                  />
                </div>
                <span className="badge">{(component.style.focalY ?? 50).toFixed(0)}%</span>
                <button
                  className="btn"
                  disabled={!canEdit}
                  onClick={() => onUpdate({ ...component, style: { ...component.style, focalX: null, focalY: null } })}
                >
                  Auto
                </button>
                <button
                  className="btn"
                  disabled={!canEdit}
                  onClick={() => onUpdate({ ...component, style: { ...component.style, focalX: 50, focalY: 50 } })}
                >
                  Center
                </button>
              </div>
              <div className="muted">Tip: with the image selected, click inside the image to set the focal point.</div>
            </div>

            <div className="field">
              <label>Max width</label>
              <select
                data-testid="image-style-maxwidth"
                value={component.style.maxWidth ?? ""}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({
                    ...component,
                    style: {
                      ...component.style,
                      maxWidth:
                        e.target.value === ""
                          ? null
                          : e.target.value === "480"
                            ? 480
                            : e.target.value === "720"
                              ? 720
                              : e.target.value === "980"
                                ? 980
                                : null,
                    },
                  })
                }
              >
                <option value="">(auto)</option>
                <option value="480">480</option>
                <option value="720">720</option>
                <option value="980">980</option>
              </select>
            </div>

            <div className="field">
              <label>Radius</label>
              <div className="row">
                <input
                  data-testid="image-style-radius"
                  type="range"
                  min={0}
                  max={32}
                  value={component.style.radius ?? 12}
                  disabled={!canEdit}
                  onChange={(e) => onUpdate({ ...component, style: { ...component.style, radius: Number(e.target.value) } })}
                  style={{ flex: 1 }}
                />
                <span className="badge">{(component.style.radius ?? 12).toFixed(0)}px</span>
                <button className="btn" disabled={!canEdit} onClick={() => onUpdate({ ...component, style: { ...component.style, radius: null } })}>
                  Auto
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="field">
          <label>Asset</label>
          <select
            value={component.assetId}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...component, assetId: e.target.value })}
          >
            {imageAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.filename}
              </option>
            ))}
          </select>
          <div className="muted">Switch which uploaded image is used by this block.</div>
        </div>

        <div className="field">
          <label>Replace (upload new)</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            data-testid="image-replace-upload"
            disabled={!canEdit}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!file) return;
              const asset = await onUploadImageAssetOnly(file);
              onUpdate({ ...component, assetId: asset.id });
            }}
          />
          <div className="muted">Uploads a new asset and points this image block to it (MVP replace).</div>
        </div>

        <div className="field">
          <label>Caption</label>
          <input
            value={component.caption}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...component, caption: e.target.value })}
          />
          <div className="muted">Alt text is stored on the asset (MVP).</div>
        </div>
      </div>
    );
  }

  return null;
}

function ImageEditorModal(props: {
  title: string;
  srcUrl: () => string;
  initialAlt: () => string;
  canEdit: boolean;
  replaceAllUsages: boolean;
  onChangeReplaceAllUsages: (next: boolean) => void;
  onCancel: () => void;
  onSave: (file: File) => Promise<void>;
}) {
  const { title, srcUrl, canEdit, replaceAllUsages, onChangeReplaceAllUsages, onCancel, onSave } = props;
  const src = srcUrl();

  type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const [aspect, setAspect] = useState<string>("free"); // free | 1:1 | 4:3 | 16:9 | original
  const [cropScale, setCropScale] = useState(0.82); // fraction of viewport
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rotateDeg, setRotateDeg] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [outputMaxPx, setOutputMaxPx] = useState(1600);
  const [format, setFormat] = useState<"image/webp" | "image/png" | "image/jpeg">("image/webp");
  const [quality, setQuality] = useState(0.9);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const update = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    update();

    const obs = new ResizeObserver(() => update());
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const computed = useMemo(() => {
    if (!natural || viewport.w <= 0 || viewport.h <= 0) return null;
    const vw = viewport.w;
    const vh = viewport.h;

    const effectiveNatural =
      rotateDeg === 90 || rotateDeg === 270 ? { w: natural.h, h: natural.w } : { w: natural.w, h: natural.h };

    let desiredAspect: number | null = null;
    if (aspect === "1:1") desiredAspect = 1;
    if (aspect === "4:3") desiredAspect = 4 / 3;
    if (aspect === "16:9") desiredAspect = 16 / 9;
    if (aspect === "original") desiredAspect = effectiveNatural.w / effectiveNatural.h;

    const maxW = vw * cropScale;
    const maxH = vh * cropScale;
    let cw = maxW;
    let ch = maxH;
    if (desiredAspect) {
      cw = maxW;
      ch = cw / desiredAspect;
      if (ch > maxH) {
        ch = maxH;
        cw = ch * desiredAspect;
      }
    }

    const cx = (vw - cw) / 2;
    const cy = (vh - ch) / 2;

    const baseScale = Math.max(cw / effectiveNatural.w, ch / effectiveNatural.h);
    const scale = baseScale * zoom;

    const imgHalfW = (effectiveNatural.w * scale) / 2;
    const imgHalfH = (effectiveNatural.h * scale) / 2;

    const minCenterX = cx + cw - imgHalfW;
    const maxCenterX = cx + imgHalfW;
    const minCenterY = cy + ch - imgHalfH;
    const maxCenterY = cy + imgHalfH;

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const clampedCenterX = clamp(vw / 2 + offset.x, minCenterX, maxCenterX);
    const clampedCenterY = clamp(vh / 2 + offset.y, minCenterY, maxCenterY);

    const clampedOffset = { x: clampedCenterX - vw / 2, y: clampedCenterY - vh / 2 };

    const imgLeft = clampedCenterX - imgHalfW;
    const imgTop = clampedCenterY - imgHalfH;

    return {
      crop: { x: cx, y: cy, w: cw, h: ch },
      scale,
      clampedOffset,
      imgLeft,
      imgTop,
      vw,
      vh,
      effectiveNatural,
    };
  }, [aspect, cropScale, natural, offset.x, offset.y, rotateDeg, viewport.h, viewport.w, zoom]);

  useEffect(() => {
    if (!computed) return;
    if (computed.clampedOffset.x === offset.x && computed.clampedOffset.y === offset.y) return;
    setOffset(computed.clampedOffset);
  }, [computed, offset.x, offset.y]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!canEdit) return;
      if (!computed) return;
      const el = viewportRef.current;
      if (!el) return;
      el.focus();
      el.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY };
      const startOffset = { ...offset };

      const onMove = (ev: PointerEvent) => {
        setOffset({ x: startOffset.x + (ev.clientX - start.x), y: startOffset.y + (ev.clientY - start.y) });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [canEdit, computed, offset]
  );

  const onViewportKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!canEdit) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }

      const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
      const nudge = e.shiftKey ? 10 : 1;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        setOffset((prev) => ({ x: prev.x - nudge, y: prev.y }));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        setOffset((prev) => ({ x: prev.x + nudge, y: prev.y }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setOffset((prev) => ({ x: prev.x, y: prev.y - nudge }));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setOffset((prev) => ({ x: prev.x, y: prev.y + nudge }));
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        e.stopPropagation();
        setZoom((prev) => clamp(prev + 0.05, 1, 3));
        return;
      }
      if (e.key === "-") {
        e.preventDefault();
        e.stopPropagation();
        setZoom((prev) => clamp(prev - 0.05, 1, 3));
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        e.stopPropagation();
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
    },
    [canEdit]
  );

  const onCropHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: CropHandle) => {
      if (!canEdit) return;
      if (!computed) return;
      const viewportEl = viewportRef.current;
      if (!viewportEl) return;
      viewportEl.focus();

      e.preventDefault();
      e.stopPropagation();

      const rect = viewportEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
      const minScale = 0.5;
      const maxScale = 0.95;

      const updateFromPointer = (clientX: number, clientY: number) => {
        const halfW =
          handle.includes("w") ? Math.max(18, centerX - clientX) : handle.includes("e") ? Math.max(18, clientX - centerX) : rect.width / 2;
        const halfH =
          handle.includes("n") ? Math.max(18, centerY - clientY) : handle.includes("s") ? Math.max(18, clientY - centerY) : rect.height / 2;

        const scaleW = (2 * halfW) / rect.width;
        const scaleH = (2 * halfH) / rect.height;

        let next = cropScale;
        if (handle === "e" || handle === "w") next = scaleW;
        else if (handle === "n" || handle === "s") next = scaleH;
        else next = Math.max(scaleW, scaleH);

        setCropScale(clamp(next, minScale, maxScale));
      };

      const startTarget = e.currentTarget as HTMLElement;
      startTarget.setPointerCapture(e.pointerId);
      updateFromPointer(e.clientX, e.clientY);

      const onMove = (ev: PointerEvent) => updateFromPointer(ev.clientX, ev.clientY);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [canEdit, computed, cropScale]
  );

  const renderToFile = useCallback(async (): Promise<File> => {
    if (!computed || !imgRef.current) throw new Error("Image is not ready yet.");

    const { crop, imgLeft, imgTop, scale, effectiveNatural: nat } = computed;
    const sx = (crop.x - imgLeft) / scale;
    const sy = (crop.y - imgTop) / scale;
    const sw = crop.w / scale;
    const sh = crop.h / scale;

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const clampedSw = clamp(sw, 1, nat.w);
    const clampedSh = clamp(sh, 1, nat.h);
    const clampedSx = clamp(sx, 0, nat.w - clampedSw);
    const clampedSy = clamp(sy, 0, nat.h - clampedSh);

    const ratio = clampedSw / clampedSh;
    let outW = outputMaxPx;
    let outH = Math.max(1, Math.round(outW / ratio));
    if (outH > outputMaxPx) {
      outH = outputMaxPx;
      outW = Math.max(1, Math.round(outH * ratio));
    }

    const transformed = document.createElement("canvas");
    transformed.width = nat.w;
    transformed.height = nat.h;
    const tctx = transformed.getContext("2d");
    if (!tctx) throw new Error("Missing 2d context");

    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    tctx.save();
    tctx.translate(nat.w / 2, nat.h / 2);
    tctx.rotate((rotateDeg * Math.PI) / 180);
    tctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    if (!natural) throw new Error("Missing image dimensions");
    tctx.drawImage(imgRef.current, -natural.w / 2, -natural.h / 2, natural.w, natural.h);
    tctx.restore();

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Missing 2d context");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(transformed, clampedSx, clampedSy, clampedSw, clampedSh, 0, 0, outW, outH);

    const blob =
      (await canvasToBlob(canvas, format, format === "image/png" ? undefined : quality).catch(() => null)) ??
      (await canvasToBlob(canvas, "image/png").catch(() => null));

    if (!blob) throw new Error("Failed to create image output");

    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
    return new File([blob], `edited.${ext}`, { type: blob.type });
  }, [computed, flipH, flipV, format, natural, outputMaxPx, quality, rotateDeg]);

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" onClick={() => onCancel()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>{title}</div>
            <span className="badge">{format.replace("image/", "")}</span>
          </div>
          <div className="row">
            <button className="btn" onClick={() => onCancel()}>
              Close
            </button>
          </div>
        </div>

        <div className="modalBody">
          {src ? (
            <div className="stack" style={{ gap: 12 }}>
              <div
                className="cropViewport"
                ref={viewportRef}
                data-testid="image-editor-viewport"
                tabIndex={canEdit ? 0 : -1}
                aria-label="Image crop viewport"
                aria-describedby="image-editor-tip"
                onPointerDown={onPointerDown}
                onKeyDown={onViewportKeyDown}
              >
                <img
                  ref={imgRef}
                  src={src}
                  alt=""
                  draggable={false}
                  data-testid="image-editor-image"
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                    setError(null);
                  }}
                  onError={() => setError("Failed to load image.")}
                  style={
                    computed
                      ? {
                          position: "absolute",
                          left: "50%",
                          top: "50%",
                          transform: `translate(-50%, -50%) translate(${computed.clampedOffset.x}px, ${computed.clampedOffset.y}px) rotate(${rotateDeg}deg) scale(${computed.scale * (flipH ? -1 : 1)}, ${computed.scale * (flipV ? -1 : 1)})`,
                          transformOrigin: "center center",
                          willChange: "transform",
                          userSelect: "none",
                          pointerEvents: "none",
                        }
                      : {
                          position: "absolute",
                          left: "50%",
                          top: "50%",
                          transform: "translate(-50%, -50%)",
                          opacity: 0.65,
                          pointerEvents: "none",
                        }
                  }
                />

                {computed ? (
                  <div
                    className="cropBox"
                    data-testid="image-editor-cropbox"
                    style={{
                      left: computed.crop.x,
                      top: computed.crop.y,
                      width: computed.crop.w,
                      height: computed.crop.h,
                    }}
                  >
                    {canEdit ? (
                      <>
                        <div
                          className="cropHandle"
                          data-dir="nw"
                          data-testid="image-editor-crophandle-nw"
                          onPointerDown={(e) => onCropHandlePointerDown(e, "nw")}
                        />
                        <div
                          className="cropHandle"
                          data-dir="n"
                          data-testid="image-editor-crophandle-n"
                          onPointerDown={(e) => onCropHandlePointerDown(e, "n")}
                        />
                        <div
                          className="cropHandle"
                          data-dir="ne"
                          data-testid="image-editor-crophandle-ne"
                          onPointerDown={(e) => onCropHandlePointerDown(e, "ne")}
                        />
                        <div
                          className="cropHandle"
                          data-dir="e"
                          data-testid="image-editor-crophandle-e"
                          onPointerDown={(e) => onCropHandlePointerDown(e, "e")}
                        />
                        <div
                          className="cropHandle"
                          data-dir="se"
                          data-testid="image-editor-crophandle-se"
                          onPointerDown={(e) => onCropHandlePointerDown(e, "se")}
                        />
                        <div
                          className="cropHandle"
                          data-dir="s"
                          data-testid="image-editor-crophandle-s"
                          onPointerDown={(e) => onCropHandlePointerDown(e, "s")}
                        />
                        <div
                          className="cropHandle"
                          data-dir="sw"
                          data-testid="image-editor-crophandle-sw"
                          onPointerDown={(e) => onCropHandlePointerDown(e, "sw")}
                        />
                        <div
                          className="cropHandle"
                          data-dir="w"
                          data-testid="image-editor-crophandle-w"
                          onPointerDown={(e) => onCropHandlePointerDown(e, "w")}
                        />
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {error ? <div className="card">{error}</div> : null}
              <div className="muted" id="image-editor-tip">
                Tip: drag to pan • resize handles adjust crop size • Arrow keys nudge (Shift = bigger) • +/- zoom • 0 resets view
              </div>

              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div className="field" style={{ minWidth: 160 }}>
                  <label>Aspect</label>
                  <select
                    data-testid="image-editor-aspect"
                    value={aspect}
                    onChange={(e) => setAspect(e.target.value)}
                    disabled={!canEdit}
                  >
                    <option value="free">free</option>
                    <option value="original">original</option>
                    <option value="1:1">1:1</option>
                    <option value="4:3">4:3</option>
                    <option value="16:9">16:9</option>
                  </select>
                </div>

                <div className="field" style={{ minWidth: 220, flex: 1 }}>
                  <label>Zoom</label>
                  <input
                    data-testid="image-editor-zoom"
                    type="range"
                    min={1}
                    max={3}
                    step={0.01}
                    value={zoom}
                    disabled={!canEdit}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  />
                </div>

                <div className="field" style={{ minWidth: 220, flex: 1 }}>
                  <label>Crop size</label>
                  <input
                    data-testid="image-editor-cropscale"
                    type="range"
                    min={0.5}
                    max={0.95}
                    step={0.01}
                    value={cropScale}
                    disabled={!canEdit}
                    onChange={(e) => setCropScale(Number(e.target.value))}
                  />
                </div>

                <div className="field" style={{ minWidth: 230 }}>
                  <label>Transform</label>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      data-testid="image-editor-rotate-left"
                      disabled={!canEdit}
                      onClick={() => setRotateDeg((prev) => (prev === 0 ? 270 : prev === 90 ? 0 : prev === 180 ? 90 : 180))}
                      title="Rotate left (90°)"
                    >
                      Rotate ↺
                    </button>
                    <button
                      className="btn"
                      data-testid="image-editor-rotate-right"
                      disabled={!canEdit}
                      onClick={() => setRotateDeg((prev) => (prev === 0 ? 90 : prev === 90 ? 180 : prev === 180 ? 270 : 0))}
                      title="Rotate right (90°)"
                    >
                      Rotate ↻
                    </button>
                    <button
                      className={flipH ? "btn btnPrimary" : "btn"}
                      data-testid="image-editor-flip-h"
                      disabled={!canEdit}
                      onClick={() => setFlipH((v) => !v)}
                      title="Flip horizontally"
                    >
                      Flip H
                    </button>
                    <button
                      className={flipV ? "btn btnPrimary" : "btn"}
                      data-testid="image-editor-flip-v"
                      disabled={!canEdit}
                      onClick={() => setFlipV((v) => !v)}
                      title="Flip vertically"
                    >
                      Flip V
                    </button>
                    {rotateDeg !== 0 || flipH || flipV ? (
                      <button
                        className="btn"
                        data-testid="image-editor-transform-reset"
                        disabled={!canEdit}
                        onClick={() => {
                          setRotateDeg(0);
                          setFlipH(false);
                          setFlipV(false);
                        }}
                        title="Reset transform"
                      >
                        Reset
                      </button>
                    ) : null}
                    <span className="badge" title="Rotation">
                      {rotateDeg}°
                    </span>
                  </div>
                </div>

                <div className="field" style={{ width: 130 }}>
                  <label>Max px</label>
                  <input
                    inputMode="numeric"
                    value={String(outputMaxPx)}
                    disabled={!canEdit}
                    onChange={(e) => setOutputMaxPx(Number(e.target.value || "0") || 1600)}
                  />
                </div>

                <div className="field" style={{ width: 140 }}>
                  <label>Format</label>
                  <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} disabled={!canEdit}>
                    <option value="image/webp">webp</option>
                    <option value="image/jpeg">jpg</option>
                    <option value="image/png">png</option>
                  </select>
                </div>

                <div className="field" style={{ minWidth: 180 }}>
                  <label>Quality</label>
                  <input
                    type="range"
                    min={0.6}
                    max={1}
                    step={0.01}
                    value={quality}
                    disabled={!canEdit || format === "image/png"}
                    onChange={(e) => setQuality(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <label className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={replaceAllUsages}
                    disabled={!canEdit}
                    onChange={(e) => onChangeReplaceAllUsages(e.target.checked)}
                  />
                  <span className="muted">Replace all usages on the page</span>
                </label>

                <div className="row">
                  <button className="btn" onClick={() => onCancel()} disabled={isSaving}>
                    Cancel
                  </button>
                  <button
                    className="btn btnPrimary"
                    disabled={!canEdit || isSaving || !natural}
                    onClick={async () => {
                      setIsSaving(true);
                      setError(null);
                      try {
                        const file = await renderToFile();
                        await onSave(file);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Failed to save edited image.");
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                  >
                    {isSaving ? "Saving..." : "Save as new asset"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card">Missing image source.</div>
          )}
        </div>
      </div>
    </div>
  );
}
