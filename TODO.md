# Creative Agentic CMS — TODO Plan

This file is the implementation roadmap for `dev/creative-agentic-cms/`.
It is organized by milestones and designed to be executed incrementally with continuous E2E testing.

## Milestone 0 — Foundations (keep velocity high)

- [x] Keep `pnpm-lock.yaml` pinned and CI-friendly (no floating versions).
- [ ] Add `pnpm lint` + minimal TS checks (typecheck) across packages.
- [ ] Add a consistent error UI pattern (toast + inline error details).
- [ ] Add `undo/redo` foundations (command stack) for all page edits.
- [ ] Add autosave (debounced) + explicit “Save now” + conflict handling (future).

## Milestone 1 — Editor Model (schema + rendering)

- [ ] Expand `@cac/shared` schema:
  - [x] Section style: background, padding, max-width.
  - [ ] Section-level settings: layout (stack/grid), spacing, visibility.
  - [x] Image component style: fit, align, max-width, radius.
  - [ ] Component-level settings: style tokens (typography, spacing, alignment) for all components.
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
  - [x] Move components across sections (Preview drop zones).
  - [ ] Move components across sections via Structure list (optional).
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
  - [x] Modal editor with zoom/pan/crop presets + output resize.
  - [x] Non-destructive workflow (save as new asset + optional replace usages).
  - [x] “Update image in preview” UX (select image → Edit/Replace buttons).
  - [ ] Crop rectangle resize handles + keyboard nudges (optional UX upgrade).
  - [ ] Rotate / flip (optional).

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
  - [x] Mic STT input for prompt (browser SpeechRecognition).
  - [ ] “Suggest” mode (draft plan + changes summary) vs “Apply” mode.
  - [ ] Step-by-step edits (agent proposes patches, user approves each).
- [ ] Reliability:
  - [x] Guard: no implicit deletions.
  - [x] Guard: block unexpected reorder/add/moves unless explicitly requested.
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
  - [x] cross-section DnD move
  - [x] image replace
  - [x] image edit (styles + editor)
  - [ ] style edits + export correctness
  - [ ] agent run (skip if no key)
  - [x] screenshot capture (enable via `CAC_E2E_SCREENSHOT=1`)
- [ ] ChromeDev MCP “manual script” checklist:
  - [ ] drag, edit, upload, screenshot, agent edit, export.

## Milestone 9 — Deployment

- [ ] Production runbook (systemd unit + reverse proxy).
- [ ] Serve web build from server (optional single-process deploy).
- [ ] Backups for `projects/` directory.
