# Mission

## What Creative Agentic CMS Is

Creative Agentic CMS (CAC) is a WYSIWYG creative editor for composing a single web page — its layout, sections, components, and images — through a combination of visual drag-and-drop tooling and an LLM-powered AI agent that helps the user design, restructure, edit, and populate the page with content.

The editor is an MVP / creative demo. It runs locally against the project filesystem. There is no database, no multi-user collaboration surface, and no CMS backend. Each "project" is a directory with its own page definition and assets.

The agent works with always-up-to-date context about the page: the generated markup (with long text truncated for context efficiency), an automatically captured screenshot of the preview area, and browser automation tools (ChromeDev MCP Server) for inspecting markup, network activity, console, and interactive debugging — so that the agent can see, reason about, and steer the page the same way the user does.

## Who It's For

A single designer / content creator working on one web page at a time who wants:
- A joyful, highly visual composer for structuring and populating a page
- A capable AI collaborator that can draft, restructure, replace, and iterate on page content with live preview
- First-class inline editing of sections, components, and media
- Image editing (upload, resize, crop, placement, re-editing) and AI image generation, all inside the editor
- Clean, SEO- and GEO-optimized markup as the final output, ready to serve

Creative Agentic CMS is **not** a headless CMS, a multi-tenant publishing platform, a content workflow system, or a team collaboration tool. It is a local-first, single-page authoring experience.

## Core Capabilities (In Scope)

**Visual page composition**
- Builder palette with tools for page metadata, layouts, sections, and components
- Drag-and-drop composition of sections and components onto the page
- Library of building blocks available to the user and visible to the agent through context
- Insite (in-place, on-canvas) editing of currently composed page, sections, components, and all content

**AI agent editing**
- LangChain.js-based agent that assists with page and content creation
- Agent receives: current generated markup (with long text truncated), the latest auto-captured preview screenshot (referenced by path in context), and editor-capability + building-block context
- Agent can use the ChromeDev MCP Server to inspect the preview page (markup, network, console) and drive the browser when useful
- Agent can restructure the page, edit sections/components, generate or replace copy, and trigger image operations

**Image handling**
- Upload images into the project's `assets/` folder
- Transform images (resize, crop)
- Place images into components and edit placements
- Re-edit previously placed images
- **AI image generation is a first-class, in-scope Core Capability.** A dedicated LangChain.js-based image-generation agent (on top of `@langchain/openai`) takes a user prompt plus output-size/quality options and produces images. Generated images flow into the same `assets/` folder via a generation → temporary preview → save-to-gallery pattern. The reference implementation in `docs/examples/imagegen` is the blueprint to rewrite idiomatically in Node/TypeScript. Issues asking for this feature, for UI around it (generation dialog, form, preview, save controls), or for refinements of it (prompt handling, size/quality options, rate limiting, error mapping, TTL-temp cache) are accepted.

**Live preview**
- Preview area renders the currently composed page
- Screenshots of the preview are taken automatically and kept up to date for the agent
- Screenshots and other auxiliary editing files live under `.workspace/` inside the project directory

**Contact forms**
- Creation of simple contact forms inside the composed page is supported

**Output**
- Produced markup, scripts, styles, and final images are written to the project root (or its subfolders)
- Output is SEO- and GEO-optimized, including metadata and techniques intended for AI agents, and tuned for Page Speed Insights quality and performance metrics

**Project data storage (MVP demo)**
- Projects live on the local filesystem under `./projects/<projectId>/`
  - `page.json` — page structure and content
  - `assets/` — uploaded and generated images
  - `.workspace/` — screenshots, thumbnails, and temporary editing artifacts

**Browser support**
- The two most recent versions of: Google Chrome, Mozilla Firefox, Apple Safari, Microsoft Edge, Brave

**End-to-end testing**
- Editor capabilities MUST be end-to-end tested during implementation using browser automation tools (clicking, scrolling, resizing, filling, typing, humanlike mouse movement, screenshots), with pre-created test pages / test assets / test content across multiple sample projects

## Out of Scope (Factory Must Never Build)

The factory is forbidden from accepting issues that expand the product in any of these directions. Issues asking for these things must be rejected at triage.

**CMS / platform features**
- A database of any kind (the demo is filesystem-only by design)
- Content locking, versioning, branching, or draft/publish workflows
- Releases, staging environments, or content activity timelines
- Audit logs or event streams
- Cost tracking or usage dashboards
- User comments or article-comment components
- Headless CMS APIs (public or internal) for third-party consumers of the content
- Multi-user collaboration, shared editing, presence, or permissions systems
- Multi-tenancy of any kind

**Authentication, accounts, and monetization**
- User accounts, sign-in, role systems, SSO, or any authentication beyond what the local dev setup requires
- Payments, subscriptions, tiers, paywalls, or monetization features

**Distribution**
- Mobile apps (React Native, Flutter), desktop apps (Electron, Tauri), or browser extensions
- SaaS hosting of the editor for end users

**LLM and integration stack**
- Swapping the LLM provider away from OpenAI
- Adding alternative LLM providers as user-selectable options
- Adding local/self-hosted model support (Ollama, llama.cpp, etc.)
- Integrations with Slack, Discord, Telegram, or similar chat platforms
- Webhooks to third-party services
- Commercial-licensed libraries (see CLAUDE.md)

**Scope creep around the single-page model**
- Multi-page site builder, site trees, navigation graphs
- Cross-page content reuse, shared components across pages (beyond the local block library inside one project)

## Hard Invariants (Not Tunable by Factory Issues)

These constraints define what Creative Agentic CMS is. The factory cannot modify them even if an issue asks nicely or claims it's a bug.

1. **Filesystem-only storage.** No database is introduced into the demo. Project data lives under `./projects/<projectId>/` on the local filesystem. Any issue asking to introduce a database is out of scope.

2. **Single-page per project.** A project represents one web page. Multi-page composition is not a feature the factory can add.

3. **OpenAI is the only LLM provider.** Direct connection via `@langchain/openai`, with a circuit breaker on the LLM channel. No provider swaps, no alternatives, no local models, no LiteLLM proxy in this iteration.

4. **No accounts / no auth layer in the product.** The editor is a local creative tool. The factory must not add user accounts, login flows, or permission checks.

5. **Governance files cannot be modified by the factory.** `MISSION.md`, `FACTORY_RULES.md`, and `CLAUDE.md` are the constitution. Any PR touching them is an automatic reject.

6. **No new commercial-licensed dependencies.** The factory must not introduce any library that requires a commercial license.

## Allowed Evolutions

These are explicitly in scope and the factory can work on them when issues are filed:

- **Builder palette UX.** Growing and refining the palette of tools for metadata, layouts, sections, and components.
- **Component and block library.** Adding new building blocks, improving existing ones, enriching the context the agent has about them.
- **Insite editing UX.** Improving on-canvas editing of sections, components, and content.
- **Agent capabilities.** Better context construction, better use of screenshots and ChromeDev MCP, better prompt engineering, better live-preview feedback loops — all while staying on OpenAI via `@langchain/openai`.
- **Image editor.** Upload, resize, crop, placement, re-edit, and AI image generation flows.
- **SEO / GEO / Page Speed quality of output.** Improving metadata, structured data, and performance characteristics of produced markup.
- **Contact form tooling.** Better authoring, validation, and output of simple contact forms.
- **Test coverage.** Adding E2E tests with browser automation for editor flows and example projects.
- **Sample projects and test assets.** Expanding the pre-created test pages / assets / content used to exercise the editor.

## Quality Standards (Definition of Done)

Every change the factory ships must clear all three gates. A PR that skips any of these is not done.

**Gate 1 — Static checks pass**
- Type-check: zero errors (TypeScript strict)
- Lint: zero warnings
- Format: clean
- Build: succeeds (`pnpm build`)
- Unit and integration tests: all pass (`pnpm test`)

**Gate 2 — UI is discoverable without docs**
- Any new user-facing feature must be usable by a first-time user without reading external documentation
- No hidden keyboard shortcuts, no undocumented URL parameters, no "you have to know about this" affordances
- If a feature needs an explanation, the explanation belongs in the UI

**Gate 3 — End-to-end regression test via browser automation**
Every change — bug fix, feature, refactor, docs update that touches runnable code — must pass an end-to-end browser test that exercises the relevant editor flow on a seeded sample project. Typical happy paths:

1. Start the API server and web UI locally
2. Open a seeded sample project in the editor at `http://localhost:5173`
3. Exercise the flow affected by the change (e.g., drag a section, edit a component insite, upload/transform an image, generate an image via the AI flow, invoke the agent, export the page)
4. Verify the live preview updates and a fresh preview screenshot is captured
5. Verify produced markup in the project directory reflects the change

Static checks and unit tests are necessary but not sufficient; the editor itself must demonstrably work end-to-end in a real browser.

## Non-Goals (Things Creative Agentic CMS Is Explicitly Not Trying To Be)

- A headless CMS
- A multi-page site builder
- A multi-tenant SaaS
- A team collaboration or content workflow product
- A CMS with content locking, versioning, releases, or audit surfaces
- A marketplace or plugin ecosystem
- A monetized product
- A mobile or desktop app
- A hosting platform

Creative Agentic CMS is a focused, local-first, AI-powered single-page creative editor. Every feature decision should reinforce that focus. When in doubt, the answer is "that's out of scope."
