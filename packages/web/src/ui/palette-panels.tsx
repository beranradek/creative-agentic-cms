import React from "react";
import {
  THEME_PRESETS,
  type Page,
  resolveTheme,
} from "@cac/shared";
import { clearDragPayload, getDragPayload, setDragPayload } from "./editor-dnd.js";

export interface PageMetadataPanelProps {
  page: Page;
  canEdit: boolean;
  onChangeMetadata: (patch: Partial<Page["metadata"]>) => void;
}

export interface ThemePanelProps {
  page: Page;
  canEdit: boolean;
  resolvedTheme: ReturnType<typeof resolveTheme>;
  onChangeTheme: (recipe: (prevTheme: Page["theme"]) => Page["theme"]) => void;
}

export interface SectionsPanelProps {
  page: Page;
  canEdit: boolean;
  selected: { sectionId: string; componentId?: string } | null;
  editingSectionLabelId: string | null;
  editingSectionLabelValue: string;
  dragOverSectionId: string | null;
  dragOverComponentSectionId: string | null;
  onSelectSection: (sectionId: string) => void;
  onMoveSection: (sectionId: string, delta: -1 | 1) => void;
  onRemoveSection: (sectionId: string) => void;
  onRenameSectionStart: (sectionId: string, currentLabel: string) => void;
  onRenameSectionChange: (value: string) => void;
  onRenameSectionCommit: (sectionId: string) => void;
  onRenameSectionCancel: () => void;
  onMoveSelectedComponentToSection: (sectionId: string) => void;
  onDropComponentIntoSection: (sectionId: string, componentId: string) => void;
  onReorderSectionByDrop: (fromSectionId: string, toSectionId: string) => void;
  onSetDragOverSectionId: (sectionId: string | null) => void;
  onSetDragOverComponentSectionId: (sectionId: string | null) => void;
}

export function PageMetadataPanel(props: PageMetadataPanelProps) {
  const { page, canEdit, onChangeMetadata } = props;

  return (
    <div className="card" data-testid="page-metadata-panel">
      <div className="cardTitle">Page metadata</div>
      <div className="stack">
        <div className="field">
          <label>Title</label>
          <input value={page.metadata.title} disabled={!canEdit} onChange={(e) => onChangeMetadata({ title: e.target.value })} />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea
            rows={3}
            value={page.metadata.description}
            disabled={!canEdit}
            onChange={(e) => onChangeMetadata({ description: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

export function ThemePanel(props: ThemePanelProps) {
  const { page, canEdit, resolvedTheme, onChangeTheme } = props;

  return (
    <div className="card" data-testid="theme-panel">
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
              onChangeTheme(() => ({
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
              }));
            }}
          >
            <option value="">(default)</option>
            {THEME_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
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
              value={page.theme.bgColor ?? resolvedTheme.bgColor}
              disabled={!canEdit}
              onChange={(e) => onChangeTheme((prevTheme) => ({ ...prevTheme, bgColor: e.target.value }))}
            />
            <button className="btn" onClick={() => onChangeTheme((prevTheme) => ({ ...prevTheme, bgColor: null }))} disabled={!canEdit || page.theme.bgColor === null}>
              Auto
            </button>
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>Text</label>
            <input
              type="color"
              value={page.theme.textColor ?? resolvedTheme.textColor}
              disabled={!canEdit}
              onChange={(e) => onChangeTheme((prevTheme) => ({ ...prevTheme, textColor: e.target.value }))}
            />
            <button className="btn" onClick={() => onChangeTheme((prevTheme) => ({ ...prevTheme, textColor: null }))} disabled={!canEdit || page.theme.textColor === null}>
              Auto
            </button>
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>Muted</label>
            <input
              type="color"
              value={page.theme.mutedTextColor ?? resolvedTheme.mutedTextColor}
              disabled={!canEdit}
              onChange={(e) => onChangeTheme((prevTheme) => ({ ...prevTheme, mutedTextColor: e.target.value }))}
            />
            <button
              className="btn"
              onClick={() => onChangeTheme((prevTheme) => ({ ...prevTheme, mutedTextColor: null }))}
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
              value={page.theme.accentColor ?? resolvedTheme.accentColor}
              disabled={!canEdit}
              onChange={(e) => onChangeTheme((prevTheme) => ({ ...prevTheme, accentColor: e.target.value }))}
            />
            <button
              className="btn"
              onClick={() => onChangeTheme((prevTheme) => ({ ...prevTheme, accentColor: null }))}
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
                onChangeTheme((prevTheme) => ({ ...prevTheme, fontFamily: raw ? raw : null }));
              }}
            />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>Base size</label>
            <input
              inputMode="numeric"
              data-testid="theme-base-font"
              value={String(page.theme.baseFontSize ?? resolvedTheme.baseFontSize)}
              disabled={!canEdit}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const n = raw ? Number(raw) : NaN;
                const clamped = Number.isFinite(n) ? Math.max(12, Math.min(22, Math.round(n))) : null;
                onChangeTheme((prevTheme) => ({ ...prevTheme, baseFontSize: clamped }));
              }}
            />
            <button
              className="btn"
              onClick={() => onChangeTheme((prevTheme) => ({ ...prevTheme, baseFontSize: null }))}
              disabled={!canEdit || page.theme.baseFontSize === null}
            >
              Auto
            </button>
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>Line height</label>
            <input
              value={String(page.theme.lineHeight ?? resolvedTheme.lineHeight)}
              disabled={!canEdit}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const n = raw ? Number(raw) : NaN;
                const clamped = Number.isFinite(n) ? Math.max(1.1, Math.min(1.8, n)) : null;
                onChangeTheme((prevTheme) => ({ ...prevTheme, lineHeight: clamped }));
              }}
            />
            <button
              className="btn"
              onClick={() => onChangeTheme((prevTheme) => ({ ...prevTheme, lineHeight: null }))}
              disabled={!canEdit || page.theme.lineHeight === null}
            >
              Auto
            </button>
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>Spacing</label>
            <input
              inputMode="numeric"
              value={String(page.theme.spaceBase ?? resolvedTheme.spaceBase)}
              disabled={!canEdit}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const n = raw ? Number(raw) : NaN;
                const clamped = Number.isFinite(n) ? Math.max(4, Math.min(14, Math.round(n))) : null;
                onChangeTheme((prevTheme) => ({ ...prevTheme, spaceBase: clamped }));
              }}
            />
            <button
              className="btn"
              onClick={() => onChangeTheme((prevTheme) => ({ ...prevTheme, spaceBase: null }))}
              disabled={!canEdit || page.theme.spaceBase === null}
            >
              Auto
            </button>
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>Radius</label>
            <input
              inputMode="numeric"
              value={String(page.theme.radius ?? resolvedTheme.radius)}
              disabled={!canEdit}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const n = raw ? Number(raw) : NaN;
                const clamped = Number.isFinite(n) ? Math.max(0, Math.min(28, Math.round(n))) : null;
                onChangeTheme((prevTheme) => ({ ...prevTheme, radius: clamped }));
              }}
            />
            <button
              className="btn"
              onClick={() => onChangeTheme((prevTheme) => ({ ...prevTheme, radius: null }))}
              disabled={!canEdit || page.theme.radius === null}
            >
              Auto
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SectionsPanel(props: SectionsPanelProps) {
  const {
    page,
    canEdit,
    selected,
    editingSectionLabelId,
    editingSectionLabelValue,
    dragOverSectionId,
    dragOverComponentSectionId,
    onSelectSection,
    onMoveSection,
    onRemoveSection,
    onRenameSectionStart,
    onRenameSectionChange,
    onRenameSectionCommit,
    onRenameSectionCancel,
    onMoveSelectedComponentToSection,
    onDropComponentIntoSection,
    onReorderSectionByDrop,
    onSetDragOverSectionId,
    onSetDragOverComponentSectionId,
  } = props;

  const createComponentDropHandlers = (sectionId: string) => ({
    onDragOverCapture: (e: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      const payload = getDragPayload(e);
      if (!payload || payload.kind !== "component") return;
      onSetDragOverComponentSectionId(sectionId);
    },
    onDragEnterCapture: (e: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      const payload = getDragPayload(e);
      if (!payload || payload.kind !== "component") return;
      onSetDragOverComponentSectionId(sectionId);
    },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      const payload = getDragPayload(e);
      if (!payload || payload.kind !== "component") return;
      onSetDragOverComponentSectionId(sectionId);
    },
    onDragEnter: (e: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      const payload = getDragPayload(e);
      if (!payload || payload.kind !== "component") return;
      onSetDragOverComponentSectionId(sectionId);
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      const related = e.relatedTarget;
      if (related && related instanceof Node && (e.currentTarget as HTMLElement).contains(related)) return;
      onSetDragOverComponentSectionId(dragOverComponentSectionId === sectionId ? null : dragOverComponentSectionId);
    },
    onDropCapture: (e: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      const payload = getDragPayload(e);
      if (!payload || payload.kind !== "component") return;
      e.preventDefault();
      e.stopPropagation();
      clearDragPayload();
      onSetDragOverComponentSectionId(null);
      onDropComponentIntoSection(sectionId, payload.componentId);
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      const payload = getDragPayload(e);
      if (!payload || payload.kind !== "component") return;
      e.preventDefault();
      e.stopPropagation();
      clearDragPayload();
      onSetDragOverComponentSectionId(null);
      onDropComponentIntoSection(sectionId, payload.componentId);
    },
  });

  return (
    <div className="list">
      {page.sections.map((section, idx) => {
        const componentDropHandlers = createComponentDropHandlers(section.id);

        return (
          <div
            key={section.id}
            className="card"
            data-testid="sections-section-card"
            data-section-id={section.id}
            onDragOverCapture={(e) => {
              if (!canEdit) return;
              const payload = getDragPayload(e);
              if (!payload || payload.kind !== "section") return;
              e.preventDefault();
              onSetDragOverSectionId(section.id);
            }}
            onDragLeave={(e) => {
              const related = e.relatedTarget;
              if (related && related instanceof Node && (e.currentTarget as HTMLElement).contains(related)) return;
              onSetDragOverSectionId(dragOverSectionId === section.id ? null : dragOverSectionId);
            }}
            onDropCapture={(e) => {
              if (!canEdit) return;
              const payload = getDragPayload(e);
              if (!payload || payload.kind !== "section") return;
              e.preventDefault();
              clearDragPayload();
              onSetDragOverSectionId(null);
              onReorderSectionByDrop(payload.sectionId, section.id);
            }}
            style={dragOverSectionId === section.id ? { outline: "2px solid rgba(124, 92, 255, 0.55)", outlineOffset: 2 } : undefined}
          >
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 10 }}>
                {canEdit ? (
                  <span
                    className="dragHandle"
                    data-testid="sections-section-drag-handle"
                    draggable={canEdit && editingSectionLabelId !== section.id}
                    title="Drag to reorder section"
                    onDragStart={(e) => {
                      if (!canEdit || editingSectionLabelId === section.id) return;
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
                    onChange={(e) => onRenameSectionChange(e.target.value)}
                    autoFocus
                    style={{ width: 220 }}
                    onBlur={() => onRenameSectionCommit(section.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        onRenameSectionCancel();
                        return;
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onRenameSectionCommit(section.id);
                      }
                    }}
                  />
                ) : (
                  <div
                    className="cardTitle"
                    data-testid="section-label"
                    onDoubleClick={() => {
                      if (!canEdit) return;
                      onRenameSectionStart(section.id, section.label);
                    }}
                    title={canEdit ? "Double-click to rename" : undefined}
                  >
                    {section.label}
                  </div>
                )}
                {!section.settings.visible ? <span className="badge">hidden</span> : null}
              </div>
              <div className="row">
                <button className="btn" onClick={() => onMoveSection(section.id, -1)} disabled={!canEdit || idx === 0}>
                  ↑
                </button>
                <button className="btn" onClick={() => onMoveSection(section.id, 1)} disabled={!canEdit || idx === page.sections.length - 1}>
                  ↓
                </button>
                {selected?.componentId ? (
                  <button
                    className="btn"
                    onClick={() => onMoveSelectedComponentToSection(section.id)}
                    disabled={!canEdit}
                    title="Move selected component to this section"
                  >
                    Move here
                  </button>
                ) : null}
                <button className="btn btnDanger" onClick={() => onRemoveSection(section.id)} disabled={!canEdit}>
                  Remove
                </button>
                <button className="btn" onClick={() => onSelectSection(section.id)}>
                  Select
                </button>
              </div>
            </div>
            <div className="muted">{section.components.length} components</div>
            <div
              className="structureComponentDropZone"
              data-testid="sections-component-dropzone"
              data-section-id={section.id}
              style={
                dragOverComponentSectionId === section.id
                  ? { borderColor: "rgba(37, 99, 235, 0.6)", background: "rgba(37, 99, 235, 0.08)" }
                  : undefined
              }
              {...componentDropHandlers}
            >
              Drop component here
            </div>
          </div>
        );
      })}
    </div>
  );
}
