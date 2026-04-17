# Creative Agentic CMS

Creative CMS WYSIWYG editor for editing one page layout, page sections, components and images.
Driven by visual drag & drop composer - builder palette of tools for page metadata, layouts, sections and components,
and also driven by LLM-powered AI agent assisting with page and content creation.

Agent can help the user to restructure and edit the page by having context with both always-up-to-date generated page markup
(with longer texts truncated for context efficiency) and
visual feedback using both automatically created screenshot of the page preview area (referenced to him in the context so he knows
where to observe the most up-to-date screenshot already automatically taken for him) and browser automation tools (ChromeDev MCP Server)
(along with the instructions how to effectivelly use it within the browser editor preview page - so inspecting the page content, network logs, console and debugging the page is all possible).
Through the context, the agent also knows the editor capabilities and library of building blocks - all what can be used - like the user
creating and observing the content.

Editor allows also first-class insite editation of currently composed page, of its sections, components and all the content,
including uploading - transforming (resizing, cropping), placing new images and editing the existing ones.

The creative composing and designing process, with filling all the necessary content
is pure joy when working with such a professional editor helping with every aspect of content creation
in whatever way the user interacts with the page - through the builder palette with tools, using drag & drop, image editor,
insite editation or powerful agentic editing with immediate live preview of what is built.

Images are form of assets organized withing a folder of project directory.

For the purpose of this MVP - creative demo - the assets are stored locally in the project filesystem structure, organized into folders.
The auxiliary data for editing process such as screenshots or thumbnails, temporary files are organized in the project dir within the .workspace
directory. The output page markup, scripts and styles and final images are produced either in the root or in subfolders of the project directory.

Produced markup is first-grade both SEO and GEO-optimized with metadata and techniques for AI agents,
optimized for Page Speed Insights quality and performance metrics.

Creation of simple contact forms should be possible using this demo.

No database is involved in this demo.

No locking, versioning, editing workflows, releases, content activities, audit/event or cost tracking,
user comments or components for article comments, no CMS (headless) APIs are needed for this demo.
This is just a pure-joy-to-work with powerful inovative AI-powered editor :-)

Application will support the two most recent versions of the following browsers:
- Google Chrome
- Mozilla Firefox
- Apple Safari
- Microsoft Edge
- Brave

MUST READ for additional info - inspiration:
- https://www.storyblok.com/docs/manuals/concepts
- https://www.storyblok.com/docs/manuals/visual-editor
- https://www.storyblok.com/docs/concepts/visual-editor
- https://www.storyblok.com/docs/manuals/image-editor
- All images in docs/examples
- docs/examples/langchain-agent - example of LangChain agent abstractions to use

The editor capabilities MUST BE END-TO-END TESTED during the implementation using the browser automation tools
(clicking, scrolling, resizing, filling, typing, mouse moving like a human, taking screenshots),
also with examples of pre-created test pages and test assets and contents for multiple projects to create/edit web pages for.

## Local Development Environment

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20
- [pnpm](https://pnpm.io/) ≥ 9

### Environment Variables

```bash
cp .env.example .env
```

Notes:
- `.env` is gitignored (do not commit secrets).
- `OPENAI_API_KEY` is required when `MODEL` points to an OpenAI model (for the agent features).

### Running Tests

```bash
# Install deps (recommended)
pnpm install

# All packages
pnpm test

# E2E (Playwright)
pnpm --filter @cac/web exec playwright install
# Linux (if needed): pnpm --filter @cac/web exec playwright install-deps
pnpm --filter @cac/web test:e2e

# Single package
cd packages/<package> && pnpm test
```
