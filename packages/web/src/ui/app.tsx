import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  AssetSchema,
  PageSchema,
  type Component,
  type Page,
  type Section,
} from "@cac/shared";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; page: Page }
  | { kind: "error"; message: string };

const DEFAULT_PROJECT_ID = "demo";

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createSection(label: string): Section {
  return { id: createId("sec"), label, components: [] };
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
  return { id: createId("cmp"), type: "image", assetId, caption: "" };
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

async function apiAgentChat(projectId: string, message: string): Promise<{ assistantMessage: string; page: Page }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
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
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [selected, setSelected] = useState<{ sectionId: string; componentId?: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [agentText, setAgentText] = useState("");
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const page = state.kind === "ready" ? state.page : null;

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

  const updatePage = useCallback(
    (updater: (prev: Page) => Page) => {
      if (!page) return;
      setState({ kind: "ready", page: updater(page) });
    },
    [page]
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

    const asset = await apiUploadImage(projectId, file);
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
  }, [page, projectId, updatePage]);

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

  const runAgent = useCallback(async () => {
    if (!page) return;
    const trimmed = agentText.trim();
    if (!trimmed) return;
    setIsAgentRunning(true);
    try {
      const result = await apiAgentChat(projectId, trimmed);
      setAgentReply(result.assistantMessage);
      setState({ kind: "ready", page: result.page });
      setSelected(null);
    } finally {
      setIsAgentRunning(false);
    }
  }, [agentText, page, projectId]);

  const exportProject = useCallback(async () => {
    if (!page) return;
    setIsExporting(true);
    try {
      const result = await apiExport(projectId);
      setExportInfo(result.outputDir);
    } finally {
      setIsExporting(false);
    }
  }, [page, projectId]);

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
            >
              Add Hero
            </button>
            <button className="btn" data-testid="add-text" onClick={() => addSectionWithComponent("rich_text", "Text")}>
              Add Text
            </button>
            <button
              className="btn"
              data-testid="add-contact"
              onClick={() => addSectionWithComponent("contact_form", "Contact")}
            >
              Add Contact Form
            </button>

            <div className="card">
              <div className="cardTitle">Images</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                data-testid="upload-image"
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
                          src={`/projects/${encodeURIComponent(projectId)}/assets/${asset.filename}`}
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
                  disabled={!page || isSaving}
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
              </div>
              {exportInfo ? (
                <div className="muted">
                  Exported to <code>{exportInfo}</code>
                </div>
              ) : null}
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
                    <div key={section.id} className="stack" style={{ gap: 12 }}>
                      {section.components.map((component) => (
                        <PreviewComponent key={component.id} component={component} page={page} projectId={projectId} />
                      ))}
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
                  <div key={section.id} className="card">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div className="cardTitle">{section.label}</div>
                      <div className="row">
                        <button className="btn" onClick={() => moveSection(section.id, -1)} disabled={idx === 0}>
                          ↑
                        </button>
                        <button
                          className="btn"
                          onClick={() => moveSection(section.id, 1)}
                          disabled={idx === page.sections.length - 1}
                        >
                          ↓
                        </button>
                        <button className="btn btnDanger" onClick={() => removeSection(section.id)}>
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
    </div>
  );
}

function PreviewComponent(props: { component: Component; page: Page; projectId: string }) {
  const { component, page, projectId } = props;
  if (component.type === "hero") {
    return (
      <div className="hero">
        <h1>{component.headline}</h1>
        <p>{component.subheadline}</p>
        <a className="cta" href={component.primaryCtaHref}>
          {component.primaryCtaText}
        </a>
      </div>
    );
  }

  if (component.type === "rich_text") {
    return <div className="richText" dangerouslySetInnerHTML={{ __html: component.html }} />;
  }

  if (component.type === "contact_form") {
    return (
      <div className="contactForm" id="contact">
        <h3>{component.headline}</h3>
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
          <button className="btn btnPrimary" type="submit">
            {component.submitLabel}
          </button>
        </form>
      </div>
    );
  }

  if (component.type === "image") {
    const asset = page.assets.find((a) => a.type === "image" && a.id === component.assetId);
    if (!asset || asset.type !== "image") return null;
    return (
      <div className="imageBlock">
        <img src={`/projects/${encodeURIComponent(projectId)}/assets/${asset.filename}`} alt={asset.alt} />
        {component.caption ? <div className="imageCaption">{component.caption}</div> : null}
      </div>
    );
  }

  return null;
}

function Inspector(props: {
  section: Section;
  component: Component | null;
  imageAssets: Array<{ id: string; filename: string; alt: string }>;
  onSelect: (componentId: string) => void;
  onUpdate: (next: Section) => void;
}) {
  const { section, component, imageAssets, onSelect, onUpdate } = props;
  const [selectedImageAssetId, setSelectedImageAssetId] = useState<string>(imageAssets[0]?.id ?? "");

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
      const next: Section = {
        ...section,
        components: [...section.components, createComponent(type)],
      };
      onUpdate(next);
    },
    [onUpdate, section]
  );

  const addImage = useCallback(() => {
    if (!selectedImageAssetId) return;
    const next: Section = {
      ...section,
      components: [...section.components, createImageComponent(selectedImageAssetId)],
    };
    onUpdate(next);
  }, [onUpdate, section, selectedImageAssetId]);

  const moveComponent = useCallback(
    (componentId: string, delta: -1 | 1) => {
      const index = section.components.findIndex((c) => c.id === componentId);
      if (index < 0) return;
      const next: Section = {
        ...section,
        components: moveInArray(section.components, index, index + delta),
      };
      onUpdate(next);
    },
    [onUpdate, section]
  );

  const removeComponent = useCallback(
    (componentId: string) => {
      const next: Section = {
        ...section,
        components: section.components.filter((c) => c.id !== componentId),
      };
      onUpdate(next);
    },
    [onUpdate, section]
  );

  return (
    <div className="card">
      <div className="cardTitle">Inspector</div>
      <div className="stack">
        <div className="muted">Section: {section.label}</div>
        <div className="row">
          <button className="btn" onClick={() => add("hero")}>
            + Hero
          </button>
          <button className="btn" onClick={() => add("rich_text")}>
            + Text
          </button>
          <button className="btn" onClick={() => add("contact_form")}>
            + Form
          </button>
        </div>

        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Image asset</label>
            <select value={selectedImageAssetId} onChange={(e) => setSelectedImageAssetId(e.target.value)}>
              <option value="">(none)</option>
              {imageAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.filename}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" onClick={addImage} disabled={!selectedImageAssetId}>
            + Image
          </button>
        </div>

        <div className="list">
          {section.components.map((c, idx) => (
            <div key={c.id} className="row" style={{ justifyContent: "space-between" }}>
              <button className="btn" onClick={() => onSelect(c.id)}>
                {c.type}
              </button>
              <div className="row">
                <button className="btn" onClick={() => moveComponent(c.id, -1)} disabled={idx === 0}>
                  ↑
                </button>
                <button
                  className="btn"
                  onClick={() => moveComponent(c.id, 1)}
                  disabled={idx === section.components.length - 1}
                >
                  ↓
                </button>
                <button className="btn btnDanger" onClick={() => removeComponent(c.id)}>
                  Remove
                </button>
                <span className="badge">{c.id.slice(0, 8)}</span>
              </div>
            </div>
          ))}
        </div>

        {component ? <ComponentFields component={component} onUpdate={(next) => updateComponent(section, next, onUpdate)} /> : null}
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

function ComponentFields(props: { component: Component; onUpdate: (next: Component) => void }) {
  const { component, onUpdate } = props;

  if (component.type === "hero") {
    return (
      <div className="stack">
        <div className="field">
          <label>Headline</label>
          <input value={component.headline} onChange={(e) => onUpdate({ ...component, headline: e.target.value })} />
        </div>
        <div className="field">
          <label>Subheadline</label>
          <textarea
            rows={3}
            value={component.subheadline}
            onChange={(e) => onUpdate({ ...component, subheadline: e.target.value })}
          />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>CTA text</label>
            <input value={component.primaryCtaText} onChange={(e) => onUpdate({ ...component, primaryCtaText: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>CTA href</label>
            <input value={component.primaryCtaHref} onChange={(e) => onUpdate({ ...component, primaryCtaHref: e.target.value })} />
          </div>
        </div>
      </div>
    );
  }

  if (component.type === "rich_text") {
    return (
      <div className="field">
        <label>HTML</label>
        <textarea rows={8} value={component.html} onChange={(e) => onUpdate({ ...component, html: e.target.value })} />
        <div className="muted">MVP: edit raw HTML. Next: true inline editing.</div>
      </div>
    );
  }

  if (component.type === "contact_form") {
    return (
      <div className="stack">
        <div className="field">
          <label>Headline</label>
          <input value={component.headline} onChange={(e) => onUpdate({ ...component, headline: e.target.value })} />
        </div>
        <div className="field">
          <label>Submit label</label>
          <input value={component.submitLabel} onChange={(e) => onUpdate({ ...component, submitLabel: e.target.value })} />
        </div>
      </div>
    );
  }

  if (component.type === "image") {
    return (
      <div className="field">
        <label>Caption</label>
        <input value={component.caption} onChange={(e) => onUpdate({ ...component, caption: e.target.value })} />
        <div className="muted">Alt text is stored on the asset (MVP).</div>
      </div>
    );
  }

  return null;
}
