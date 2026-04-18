import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  AssetSchema,
  PageSchema,
  SECTION_MAX_WIDTHS,
  type Component,
  type Page,
  type Section,
} from "@cac/shared";
import { isSttSupported, startStt, stopStt } from "./stt.js";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; page: Page }
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

const DEFAULT_PROJECT_ID = "demo";

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createSection(label: string): Section {
  return { id: createId("sec"), label, style: { background: null, padding: null, maxWidth: null }, components: [] };
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
      backgroundImageAssetId: null,
    };
  }
  if (type === "rich_text") {
    return {
      id: createId("cmp"),
      type: "rich_text",
      html: "<p>Write something compelling. Keep it clear, human, and specific.</p>",
    };
  }
  if (type === "contact_form") {
    return { id: createId("cmp"), type: "contact_form", headline: "Contact", submitLabel: "Send" };
  }
  if (type === "image") {
    throw new Error("Use createImageComponent(assetId) for image components.");
  }
  throw new Error(`Unsupported component type: ${type}`);
}

function createImageComponent(assetId: string): Component {
  return { id: createId("cmp"), type: "image", assetId, caption: "", style: { fit: null, maxWidth: null, align: null, radius: null } };
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

function sanitizeRichTextHtml(inputHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${inputHtml}</div>`, "text/html");
  const wrapper = doc.body.firstElementChild;
  if (!wrapper) return "";

  const outDoc = document.implementation.createHTMLDocument("");
  const outWrapper = outDoc.createElement("div");

  const allowedTags = new Set(["p", "br", "strong", "em", "a", "ul", "ol", "li"]);

  function sanitizeHref(raw: string | null): string | null {
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

  function appendSanitized(parent: HTMLElement, node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(outDoc.createTextNode(node.textContent ?? ""));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (!allowedTags.has(tag)) {
      for (const child of Array.from(el.childNodes)) appendSanitized(parent, child);
      return;
    }

    const outEl = outDoc.createElement(tag);
    if (tag === "a") {
      const href = sanitizeHref(el.getAttribute("href"));
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

async function apiGetPage(projectId: string): Promise<Page> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/page`);
  if (!res.ok) throw new Error(`Failed to load page (${res.status})`);
  const json = (await res.json()) as unknown;
  const page = (json as { page?: unknown }).page;
  return PageSchema.parse(page);
}

async function apiPutPage(projectId: string, page: Page): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/page`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(page),
  });
  if (!res.ok) throw new Error(`Failed to save page (${res.status})`);
}

async function apiAgentChat(
  projectId: string,
  message: string,
  screenshotUrl?: string
): Promise<{ assistantMessage: string; page: Page }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, screenshotUrl }),
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const err = (json as { error?: string }).error ?? `Agent error (${res.status})`;
    throw new Error(err);
  }
  const assistantMessage = z.string().parse((json as { assistantMessage?: unknown }).assistantMessage);
  const nextPage = PageSchema.parse((json as { page?: unknown }).page);
  return { assistantMessage, page: nextPage };
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
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);
  const [loadedProjectId, setLoadedProjectId] = useState(DEFAULT_PROJECT_ID);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ sectionId: string; componentId?: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [optimizeUploads, setOptimizeUploads] = useState(true);
  const [maxUploadPx, setMaxUploadPx] = useState(1600);
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
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [imageEditor, setImageEditor] = useState<ImageEditorState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const page = state.kind === "ready" ? state.page : null;
  const canEdit = state.kind === "ready" && loadedProjectId === projectId;
  const activeProjectId = loadedProjectId;

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
      setProjectsError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsProjectsLoading(false);
    }
  }, []);

  const load = useCallback(async (projectIdOverride?: string) => {
    const effectiveProjectId = projectIdOverride ?? projectId;
    if (projectIdOverride && projectIdOverride !== projectId) setProjectId(projectIdOverride);
    setState({ kind: "loading" });
    try {
      const next = await apiGetPage(effectiveProjectId);
      setState({ kind: "ready", page: next });
      setLoadedProjectId(effectiveProjectId);
      setSelected(null);
      void refreshProjects();
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Unknown error" });
    }
  }, [projectId, refreshProjects]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const save = useCallback(async () => {
    if (!page) return;
    setIsSaving(true);
    try {
      await apiPutPage(projectId, page);
    } finally {
      setIsSaving(false);
    }
  }, [page, projectId]);

  const updatePage = useCallback((updater: (prev: Page) => Page) => {
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      return { kind: "ready", page: updater(prev.page) };
    });
  }, []);

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
    try {
      let latestScreenshotUrl: string | undefined;
      try {
        const shot = await apiCaptureScreenshot(activeProjectId, { width: 1024, height: 768, fullPage: false });
        latestScreenshotUrl = shot.screenshotUrl;
        setScreenshotUrl(shot.screenshotUrl);
      } catch {
        // Best-effort: continue without screenshot (server might not have Playwright installed).
      }

      const result = await apiAgentChat(activeProjectId, trimmed, latestScreenshotUrl);
      setAgentReply(result.assistantMessage);
      setState({ kind: "ready", page: result.page });
      setSelected(null);
    } finally {
      setIsAgentRunning(false);
    }
  }, [activeProjectId, agentText, isSttActive, page, stopAgentStt]);

  const exportProject = useCallback(async () => {
    if (!page) return;
    setIsExporting(true);
    try {
      const result = await apiExport(activeProjectId);
      setExportInfo(result.outputDir);
    } finally {
      setIsExporting(false);
    }
  }, [activeProjectId, page]);

  const captureScreenshot = useCallback(async () => {
    setIsCapturingScreenshot(true);
    try {
      const result = await apiCaptureScreenshot(activeProjectId, { width: 1200, height: 720, fullPage: true });
      setScreenshotUrl(result.screenshotUrl);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [activeProjectId]);

  return (
    <div className="shell">
      <div className="panel">
        <div className="panelHeader">
          <h2>Palette</h2>
          <span className="badge">MVP</span>
        </div>
        <div className="panelBody">
          <div className="stack">
            <div className="field">
              <label>Project</label>
              <div className="row">
                <input
                  data-testid="project-id"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                />
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
              {projectsError ? <div className="muted">Failed to load projects: {projectsError}</div> : null}
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

            <div className="card">
              <div className="cardTitle">Images</div>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label className="row" style={{ gap: 8, alignItems: "center", flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={optimizeUploads}
                    onChange={(e) => setOptimizeUploads(e.target.checked)}
                  />
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
              <div className="muted">Uploads to <code>projects/&lt;projectId&gt;/assets</code> and inserts an image block.</div>
            </div>

            <div className="card">
              <div className="cardTitle">Assets</div>
              {page ? (
                imageAssets.length ? (
                  <div className="stack">
                    {imageAssets.map((asset) => (
                      <div key={asset.id} className="row" style={{ alignItems: "flex-start" }}>
                        <img
                          src={`/projects/${encodeURIComponent(activeProjectId)}/assets/${asset.filename}`}
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
                        <div className="row" style={{ paddingTop: 18 }}>
                          <button
                            className="btn"
                            disabled={!canEdit}
                            onClick={() => setImageEditor({ kind: "asset", assetId: asset.id, replaceAllUsages: false })}
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="muted">Alt text is stored in <code>page.json</code> (asset metadata).</div>
                  </div>
                ) : (
                  <div className="muted">No assets yet. Upload an image to start a library.</div>
                )
              ) : (
                <div className="muted">Loading…</div>
              )}
            </div>

            <div className="card">
              <div className="cardTitle">Save</div>
              <div className="row">
                <button
                  className="btn btnPrimary"
                  data-testid="save-page"
                  onClick={() => void save()}
                  disabled={!canEdit || isSaving}
                >
                  {isSaving ? "Saving..." : "Save page.json"}
                </button>
                <button className="btn" data-testid="reload-page" onClick={() => void load()}>
                  Reload
                </button>
              </div>
              <div className="muted">
                Writes to <code>projects/&lt;projectId&gt;/page.json</code>.
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => void exportProject()} disabled={!page || isExporting}>
                  {isExporting ? "Exporting..." : "Export static site"}
                </button>
                <button
                  className="btn"
                  data-testid="capture-screenshot"
                  onClick={() => void captureScreenshot()}
                  disabled={!page || isCapturingScreenshot}
                >
                  {isCapturingScreenshot ? "Capturing..." : "Capture screenshot"}
                </button>
              </div>
              {exportInfo ? (
                <div className="muted">
                  Exported to <code>{exportInfo}</code>
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
                      <input value={sttLang} onChange={(e) => setSttLang(e.target.value)} disabled={!sttSupported || isAgentRunning} />
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
                    {sttInterim ? <span className="badge">listening…</span> : null}
                  </div>
                </div>
                {sttError ? <div className="muted">Mic error: {sttError}</div> : null}
              </div>
              <div className="row">
                <button
                  className="btn btnPrimary"
                  data-testid="agent-run"
                  onClick={() => void runAgent()}
                  disabled={!page || isAgentRunning}
                >
                  {isAgentRunning ? "Running..." : "Run agent"}
                </button>
                <button className="btn" onClick={() => setAgentReply(null)} disabled={!agentReply}>
                  Clear reply
                </button>
              </div>
              {agentReply ? <div className="muted">{agentReply}</div> : <div className="muted">Uses `OPENAI_API_KEY` from `.env`.</div>}
            </div>

            {state.kind === "error" ? <div className="card">{state.message}</div> : null}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panelHeader">
          <h2>Preview</h2>
          <span className="badge">{page ? `${page.sections.length} sections` : "…"}</span>
        </div>
        <div className="panelBody">
          <div className="canvas">
            <div className="preview">
              {page ? (
                <div className="stack" style={{ gap: 18 }}>
                  {page.sections.map((section) => (
                  <div
                    key={section.id}
                    className="previewSection"
                    data-testid="preview-section"
                    data-section-id={section.id}
                    style={{
                      background: section.style.background ?? undefined,
                      padding: section.style.padding !== null ? section.style.padding : undefined,
                      maxWidth: section.style.maxWidth ?? 980,
                    }}
                  >
                    <div className="stack" style={{ gap: 12 }}>
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
                          onMoveHere={(fromSectionId, fromComponentId) => {
                            if (!canEdit) return;
                            updatePage((prev) => {
                              const fromSection = prev.sections.find((s) => s.id === fromSectionId);
                              const toSection = prev.sections.find((s) => s.id === section.id);
                              if (!fromSection || !toSection) return prev;

                              const moving = fromSection.components.find((c) => c.id === fromComponentId);
                              if (!moving) return prev;

                              const nextSections = prev.sections.map((s) => {
                                if (s.id === fromSectionId && s.id === section.id) {
                                  const fromIndex = s.components.findIndex((c) => c.id === fromComponentId);
                                  const toIndex = s.components.findIndex((c) => c.id === component.id);
                                  if (fromIndex < 0 || toIndex < 0) return s;
                                  return { ...s, components: moveInArray(s.components, fromIndex, toIndex) };
                                }

                                if (s.id === fromSectionId) {
                                  return { ...s, components: s.components.filter((c) => c.id !== fromComponentId) };
                                }

                                if (s.id === section.id) {
                                  const toIndex = s.components.findIndex((c) => c.id === component.id);
                                  if (toIndex < 0) return s;
                                  const next = s.components.slice();
                                  next.splice(toIndex, 0, moving);
                                  return { ...s, components: next };
                                }

                                return s;
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
                          onMoveToEnd={(fromSectionId, fromComponentId) => {
                            if (!canEdit) return;
                            updatePage((prev) => {
                              const fromSection = prev.sections.find((s) => s.id === fromSectionId);
                              const toSection = prev.sections.find((s) => s.id === section.id);
                              if (!fromSection || !toSection) return prev;
                            const moving = fromSection.components.find((c) => c.id === fromComponentId);
                            if (!moving) return prev;

                            const nextSections = prev.sections.map((s) => {
                              if (s.id === fromSectionId && s.id === section.id) {
                                const fromIndex = s.components.findIndex((c) => c.id === fromComponentId);
                                const toIndex = s.components.length - 1;
                                if (fromIndex < 0) return s;
                                return { ...s, components: moveInArray(s.components, fromIndex, toIndex) };
                              }
                              if (s.id === fromSectionId) {
                                return { ...s, components: s.components.filter((c) => c.id !== fromComponentId) };
                              }
                              if (s.id === section.id) {
                                return { ...s, components: [...s.components, moving] };
                              }
                              return s;
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
                  ))}
                </div>
              ) : (
                <div className="muted">Loading…</div>
              )}
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

              <div className="list">
                {page.sections.map((section, idx) => (
                  <div
                    key={section.id}
                    className="card"
                    data-testid="structure-section-card"
                    data-section-id={section.id}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      if (!canEdit) return;
                      setDragPayload(e, { kind: "section", sectionId: section.id });
                    }}
                    onDragEnd={() => clearDragPayload()}
                    onDragOver={(e) => {
                      if (!canEdit) return;
                      const payload = getDragPayload(e);
                      if (!payload || payload.kind !== "section") return;
                      e.preventDefault();
                      setDragOverSectionId(section.id);
                    }}
                    onDragLeave={() => setDragOverSectionId((prev) => (prev === section.id ? null : prev))}
                    onDrop={(e) => {
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
                      <div className="cardTitle">{section.label}</div>
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
                        <button className="btn btnDanger" onClick={() => removeSection(section.id)} disabled={!canEdit}>
                          Remove
                        </button>
                        <button className="btn" onClick={() => setSelected({ sectionId: section.id })}>
                          Select
                        </button>
                      </div>
                    </div>
                    <div className="muted">{section.components.length} components</div>
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

            updatePage((prev) => PageSchema.parse({ ...prev, assets: [...prev.assets, newAsset] }));

            if (imageEditor.kind === "component") {
              updatePage((prev) => {
                const nextSections = prev.sections.map((s) => {
                  if (s.id !== imageEditor.sectionId) return s;
                  return {
                    ...s,
                    components: s.components.map((c) =>
                      c.id === imageEditor.componentId && c.type === "image" ? { ...c, assetId: newAsset.id } : c
                    ),
                  };
                });
                return PageSchema.parse({ ...prev, sections: nextSections });
              });
            }

            if (imageEditor.replaceAllUsages) {
              replaceAssetIdUsagesInPage(imageEditor.assetId, newAsset.id);
            }

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
  onMoveHere: (fromSectionId: string, fromComponentId: string) => void;
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
  const wrapperClass = isSelected ? "previewItem previewItemSelected" : "previewItem";

  const dragProps = {
    draggable: canEdit && !isSelected,
    onDragStart: (e: React.DragEvent) => {
      if (!canEdit) return;
      setDragPayload(e, { kind: "component", sectionId, componentId: component.id });
    },
    onDragEnd: () => clearDragPayload(),
    onDragOver: (e: React.DragEvent) => {
      if (!canEdit) return;
      const payload = getDragPayload(e);
      if (!payload || payload.kind !== "component") return;
      e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      if (!canEdit) return;
      const payload = getDragPayload(e);
      if (!payload || payload.kind !== "component") return;
      e.preventDefault();
      clearDragPayload();
      if (payload.sectionId === sectionId && payload.componentId === component.id) return;
      onMoveHere(payload.sectionId, payload.componentId);
    },
  };
  if (component.type === "hero") {
    const bgAsset =
      component.backgroundImageAssetId ? page.assets.find((a) => a.type === "image" && a.id === component.backgroundImageAssetId) : null;
    const heroStyle =
      bgAsset && bgAsset.type === "image"
        ? {
            backgroundImage: [
              "radial-gradient(900px 380px at 15% 15%, rgba(124, 92, 255, 0.35), transparent 60%)",
              "radial-gradient(900px 380px at 70% 20%, rgba(34, 211, 238, 0.2), transparent 60%)",
              "linear-gradient(180deg, rgba(0,0,0,0.60), rgba(0,0,0,0.20))",
              `url(/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(bgAsset.filename)})`,
            ].join(", "),
            backgroundSize: ["auto", "auto", "cover", "cover"].join(", "),
            backgroundPosition: ["0 0", "0 0", "center", "center"].join(", "),
            backgroundRepeat: ["no-repeat", "no-repeat", "no-repeat", "no-repeat"].join(", "),
          }
        : undefined;
    return (
      <div
        className={wrapperClass}
        data-testid="preview-item"
        data-component-id={component.id}
        data-component-type={component.type}
        {...dragProps}
        onClick={(e) => {
          e.preventDefault();
          onSelect();
        }}
      >
        {isSelected ? (
          <div className="previewToolbar" onClick={(e) => e.stopPropagation()}>
            <button className="btn" data-testid="preview-duplicate" onClick={() => onDuplicate()} disabled={!canEdit}>
              Duplicate
            </button>
            <button className="btn btnDanger" data-testid="preview-delete" onClick={() => onDelete()} disabled={!canEdit}>
              Delete
            </button>
          </div>
        ) : null}
        <div className="hero" style={heroStyle}>
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
          <a className="cta" href={component.primaryCtaHref} onClick={(e) => e.preventDefault()}>
            {component.primaryCtaText}
          </a>
        </div>
      </div>
    );
  }

  if (component.type === "rich_text") {
    if (isSelected && canEdit) {
      return (
        <div
          className={wrapperClass}
          data-testid="preview-item"
          data-component-id={component.id}
          data-component-type={component.type}
          {...dragProps}
          onClick={() => onSelect()}
        >
          <div className="previewToolbar" onClick={(e) => e.stopPropagation()}>
            <button className="btn" data-testid="preview-duplicate" onClick={() => onDuplicate()}>
              Duplicate
            </button>
            <button className="btn btnDanger" data-testid="preview-delete" onClick={() => onDelete()}>
              Delete
            </button>
          </div>
          <div
            key={`${component.id}-edit`}
            className="richText richTextEditable"
            contentEditable
            suppressContentEditableWarning
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const raw = e.currentTarget.innerHTML;
              const clean = sanitizeRichTextHtml(raw);
              e.currentTarget.innerHTML = clean;
              onUpdate({ ...component, html: clean });
            }}
            dangerouslySetInnerHTML={{ __html: component.html }}
          />
        </div>
      );
    }

    return (
      <div
        className={wrapperClass}
        data-testid="preview-item"
        data-component-id={component.id}
        data-component-type={component.type}
        {...dragProps}
        onClick={() => onSelect()}
      >
        <div key={`${component.id}-view`} className="richText" dangerouslySetInnerHTML={{ __html: component.html }} />
      </div>
    );
  }

  if (component.type === "contact_form") {
    return (
      <div
        className={wrapperClass}
        data-testid="preview-item"
        data-component-id={component.id}
        data-component-type={component.type}
        {...dragProps}
        onClick={() => onSelect()}
      >
        {isSelected ? (
          <div className="previewToolbar" onClick={(e) => e.stopPropagation()}>
            <button className="btn" data-testid="preview-duplicate" onClick={() => onDuplicate()} disabled={!canEdit}>
              Duplicate
            </button>
            <button className="btn btnDanger" data-testid="preview-delete" onClick={() => onDelete()} disabled={!canEdit}>
              Delete
            </button>
          </div>
        ) : null}
        <div className="contactForm" id="contact">
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
            <button className="btn btnPrimary" type="submit" onClick={(e) => e.preventDefault()}>
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
    const imgStyle: React.CSSProperties = {
      borderRadius: component.style.radius ?? undefined,
      objectFit: component.style.fit ?? undefined,
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
        {isSelected ? (
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
            <button className="btn" onClick={() => onEditImage?.()} disabled={!canEdit || !onEditImage}>
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
        <div className="imageBlock" style={blockStyle}>
          <img src={`/projects/${encodeURIComponent(projectId)}/assets/${asset.filename}`} alt={asset.alt} style={imgStyle} />
          {component.caption ? <div className="imageCaption">{component.caption}</div> : null}
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
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
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
                      style: { ...section.style, background: e.target.value },
                    })
                  }
                />
                <button
                  className="btn"
                  onClick={() => onUpdate({ ...section, style: { ...section.style, background: null } })}
                  disabled={!canEdit}
                >
                  Clear
                </button>
              </div>
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
                  onDragEnd={() => clearDragPayload()}
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
      </div>
    );
  }

  if (component.type === "rich_text") {
    return (
      <div className="field">
        <label>HTML</label>
        <textarea
          rows={8}
          value={component.html}
          disabled={!canEdit}
          onChange={(e) => onUpdate({ ...component, html: e.target.value })}
        />
        <div className="muted">MVP: edit raw HTML. Next: true inline editing.</div>
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

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const [aspect, setAspect] = useState<string>("free"); // free | 1:1 | 4:3 | 16:9 | original
  const [cropScale, setCropScale] = useState(0.82); // fraction of viewport
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
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

    let desiredAspect: number | null = null;
    if (aspect === "1:1") desiredAspect = 1;
    if (aspect === "4:3") desiredAspect = 4 / 3;
    if (aspect === "16:9") desiredAspect = 16 / 9;
    if (aspect === "original") desiredAspect = natural.w / natural.h;

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

    const baseScale = Math.max(cw / natural.w, ch / natural.h);
    const scale = baseScale * zoom;

    const imgHalfW = (natural.w * scale) / 2;
    const imgHalfH = (natural.h * scale) / 2;

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
      natural,
    };
  }, [aspect, cropScale, natural, offset.x, offset.y, viewport.h, viewport.w, zoom]);

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

  const renderToFile = useCallback(async (): Promise<File> => {
    if (!computed || !imgRef.current) throw new Error("Image is not ready yet.");

    const { crop, imgLeft, imgTop, scale, natural: nat } = computed;
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

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Missing 2d context");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgRef.current, clampedSx, clampedSy, clampedSw, clampedSh, 0, 0, outW, outH);

    const blob =
      (await canvasToBlob(canvas, format, format === "image/png" ? undefined : quality).catch(() => null)) ??
      (await canvasToBlob(canvas, "image/png").catch(() => null));

    if (!blob) throw new Error("Failed to create image output");

    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
    return new File([blob], `edited.${ext}`, { type: blob.type });
  }, [computed, format, outputMaxPx, quality]);

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
              <div className="cropViewport" ref={viewportRef} onPointerDown={onPointerDown}>
                <img
                  ref={imgRef}
                  src={src}
                  alt=""
                  draggable={false}
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
                          transform: `translate(-50%, -50%) translate(${computed.clampedOffset.x}px, ${computed.clampedOffset.y}px) scale(${computed.scale})`,
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
                    style={{
                      left: computed.crop.x,
                      top: computed.crop.y,
                      width: computed.crop.w,
                      height: computed.crop.h,
                    }}
                  />
                ) : null}
              </div>

              {error ? <div className="card">{error}</div> : null}

              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div className="field" style={{ minWidth: 160 }}>
                  <label>Aspect</label>
                  <select value={aspect} onChange={(e) => setAspect(e.target.value)} disabled={!canEdit}>
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
                    type="range"
                    min={0.5}
                    max={0.95}
                    step={0.01}
                    value={cropScale}
                    disabled={!canEdit}
                    onChange={(e) => setCropScale(Number(e.target.value))}
                  />
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
