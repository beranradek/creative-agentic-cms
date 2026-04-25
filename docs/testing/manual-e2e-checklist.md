# Manual E2E checklist (Chrome DevTools / real browser)

Use this as a quick “does it feel right?” script in addition to Playwright E2E.

## Setup

- Start dev: `pnpm dev` (or production-ish build + server).
- Open the app: `http://localhost:5173` (or your deployed URL).
- Use at least one existing project and one new project.

## Core editing

- Create a new project ID and open it.
- Add sections: Hero, Rich text, Image, Contact form.
- Inline-edit:
  - Hero headline + subheadline
  - Rich text (including bold + link)
  - Contact form headline + submit label
- Undo/redo:
  - Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z in normal inputs
  - Verify shortcuts do not break rich-text editing
- Save + reload:
  - Observe save status; try Reload while saving (should be disabled)
  - Reload and verify changes persisted

## Drag & drop

- Reorder sections via Structure drag handle.
- Reorder sections in Preview (drag handle + before/after drop).
- Move a component between sections in Preview (drop zones).
- Reorder components within a section via Inspector list.

## Assets & image editor

- Upload 2–3 images (different aspect ratios).
- Replace image from Preview toolbar (creates new asset).
- Replace asset file (keeps asset id).
- Open image editor:
  - Crop with handles + keyboard nudges
  - Zoom/pan, reset
  - Rotate 90° (confirm output aspect changes)
  - Flip H/V
- Save edited image as new asset and verify usages update as expected.

## Styling

- Apply a theme preset and verify Preview updates immediately.
- Add:
  - section background gradient
  - component box styles
  - button styles (hero CTA + contact submit)
- Switch viewport breakpoint (mobile/tablet/desktop) and verify layout remains reasonable.

## Export

- Configure Export settings:
  - Base URL
  - Enable `robots.txt` + `sitemap.xml` (should require Base URL)
  - Analytics HTML (simple `<script>` placeholder)
- Export and verify output contains:
  - canonical + `og:url` (when Base URL set)
  - OG/Twitter meta (title/description + image when present)
  - injected analytics snippet in `<head>` (when configured)
  - `robots.txt` + `sitemap.xml` when enabled

## Contact form modes (export)

- Set mode to:
  - disabled (should not submit)
  - Netlify (adds Netlify attributes + hidden form-name + honeypot)
  - Formspree/custom action URL (form `action` is set)
- Export and verify HTML form attributes match the selected mode.

## Agent (optional)

- If `OPENAI_API_KEY` is configured and `MODEL` is set:
  - Run “Suggest” and confirm it does not persist changes automatically.
  - Run “Apply” and confirm it persists changes (save+reload).
  - Ask for a small edit (e.g., “make the hero more concise”) and confirm diff budget/guardrails behave.
