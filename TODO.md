# Creative Agentic CMS — TODO Plan

This file is the implementation roadmap for `dev/creative-agentic-cms/`.
It is organized by milestones and designed to be executed incrementally with continuous E2E testing.

## Milestone 0 — Foundations (keep velocity high)

- [ ] Keep `pnpm-lock.yaml` pinned and CI-friendly (no floating versions).
- [ ] Add `pnpm lint` + minimal TS checks (typecheck) across packages.
- [ ] Add a consistent error UI pattern (toast + inline error details).
- [ ] Add `undo/redo` foundations (command stack) for all page edits.
- [ ] Add autosave (debounced) + explicit “Save now” + conflict handling (future).

## Milestone 1 — Editor Model (schema + rendering)

- [ ] Expand `@cac/shared` schema:
  - [ ] Section-level settings: layout (stack/grid), spacing, background, visibility.
  - [ ] Component-level settings: style tokens (typography, spacing, alignment).
  - [ ] Strong defaults (required-but-nullable where needed for structured outputs).
- [ ] Renderer parity:
  - [ ] Keep `web Preview` and `server export` rendering aligned (same semantics).
  - [ ] Add new components in both places (preview + export) together.

## Milestone 2 — Drag & Drop (full, intuitive)

- [ ] Sections:
  - [x] Reorder via ↑/↓ and drag&drop in Structure.
  - [ ] Drag sections directly in Preview (optional).
- [ ] Components:
  - [x] Reorder within a section (Inspector + Preview).
  - [ ] Move components across sections (Preview drop zones + Structure list).
  - [ ] Insert indicators (drop marker line) + auto-scroll while dragging.
  - [ ] Keyboard reordering (Alt+↑/↓).
- [ ] Multi-select:
  - [ ] Shift/Cmd selection of multiple components.
  - [ ] Drag group between sections.

## Milestone 3 — In-site Editing (WYSIWYG everywhere)

- [ ] Selection model:
  - [x] Click-to-select in Preview (highlight).
  - [ ] Hover toolbars (edit / duplicate / move / delete).
  - [ ] Inline rename section labels.
- [ ] Inline editing:
  - [x] `hero` headline/subheadline inline.
  - [x] `contact_form` headline/submit inline.
  - [x] `rich_text` inline (contenteditable + sanitizer on blur).
  - [ ] Inline CTA label edit (hero).
  - [ ] Inline image caption edit.
  - [ ] True rich-text toolbar (bold/italic/link/lists) + safe paste sanitization.

## Milestone 4 — Assets & Image Editing

- [ ] Asset library:
  - [x] Upload images + store in `projects/<id>/assets`.
  - [x] Edit alt text (stored in `page.json`).
  - [ ] Replace an existing image asset file (keep same `asset.id`).
  - [ ] Set image focal point (x/y) for cropping & cover.
- [ ] Image editor (MVP):
  - [ ] Modal editor with:
    - [ ] zoom
    - [ ] pan
    - [ ] crop rectangle (free + presets: 1:1, 4:3, 16:9)
    - [ ] resize output (max width)
  - [ ] Non-destructive workflow (store original + derived variants).
  - [ ] “Update image in preview” UX (select image → Edit/Replace buttons).

## Milestone 5 — Visual Styling (pleasant, powerful)

- [ ] Page-level theme:
  - [ ] global typography scale + font choices
  - [ ] color palette tokens (bg/text/accent)
  - [ ] spacing scale
- [ ] Component styling UI:
  - [ ] alignment, spacing, max-width
  - [ ] background/gradient controls
  - [ ] button style controls
  - [ ] responsive preview breakpoints
- [ ] Presets:
  - [ ] “modern landing”, “minimal”, “editorial”, “playful” presets.

## Milestone 6 — Agent (smart + safe + delightful)

- [ ] Context:
  - [x] Page snapshot text.
  - [x] Screenshot pipeline + pass image to agent (vision).
  - [ ] Add markup snapshot (rendered HTML excerpt) + diff summary.
- [ ] Controls:
  - [ ] “Suggest” mode (draft plan + changes summary) vs “Apply” mode.
  - [ ] Step-by-step edits (agent proposes patches, user approves each).
- [ ] Reliability:
  - [x] Guard: no implicit deletions.
  - [ ] Guard: limit change magnitude unless user asks (diff budget).
  - [ ] Prompt templates per component type.
- [ ] Tools:
  - [ ] Agent can request a refreshed screenshot.
  - [ ] Agent can add images by generating prompts / placeholders (future).

## Milestone 7 — Export (static site quality)

- [ ] Export options:
  - [x] Export HTML+CSS+assets into `projects/<id>/output`.
  - [ ] Per-project export config (base URL, analytics, robots, sitemap).
  - [ ] SEO metadata completeness.
- [ ] Contact form:
  - [ ] Pluggable submit (Formspree / Netlify forms / custom endpoint).

## Milestone 8 — Testing & Automation

- [x] Playwright: core E2E flows.
- [ ] Add E2E coverage for:
  - [ ] cross-section DnD move
  - [ ] image replace/edit
  - [ ] style edits + export correctness
  - [ ] agent run (skip if no key)
- [ ] ChromeDev MCP “manual script” checklist:
  - [ ] drag, edit, upload, screenshot, agent edit, export.

## Milestone 9 — Deployment

- [ ] Production runbook (systemd unit + reverse proxy).
- [ ] Serve web build from server (optional single-process deploy).
- [ ] Backups for `projects/` directory.

