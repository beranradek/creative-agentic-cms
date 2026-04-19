# Image Generation Blueprint (from ArtBeams CMS)

These files are a **reference implementation** of AI-powered image generation
extracted from the ArtBeams Kotlin/Spring Boot CMS. Use them as a blueprint for
building the equivalent capability in `creative-agentic-cms` (Node/TypeScript).
Translate the patterns — not the Kotlin syntax.

## What the feature does

A user types a prompt in the editor chat, the server calls the OpenAI image API
(`gpt-image-1`), stores the generated image in a short-lived in-memory cache,
serves it for preview, and on confirmation persists it into the media gallery
with an optional user-chosen filename.

The request is **asynchronous with polling** (not SSE / not a blocking HTTP
call) so it survives platform request timeouts and keeps the UI responsive.

## Files in this folder

### Backend — image generation specific
- `ImageGeneratingAgent.kt` — the core service. Calls OpenAI, decodes base64,
  writes bytes to a temp file, keeps a Caffeine cache (TTL 20 min, max 100
  entries) keyed by a generated temp ID. On "save" moves the bytes into the
  media gallery. Auto-cleans temp files on cache eviction.
- `ImageGeneratingAgentController.kt` — HTTP endpoints:
  - `POST /admin/articles/agent/image/generate` → creates a job, returns `jobId`
  - `GET  /admin/articles/agent/image/job/status/{jobId}` → poll status
  - `GET  /admin/articles/agent/image/temp/{tempImageId}` → serve preview bytes
  - `POST /admin/articles/agent/image/save/{tempImageId}` → commit to gallery
  Also contains **rate limiting per session** (5 req/min) and prompt length
  validation (≤1000 chars).

### Backend — reusable async-job plumbing
- `AgentJob.kt` — job record (id, sessionId, status, chunks, error, cancelled flag).
- `JobStatus.kt` — `PROCESSING | COMPLETED | ERROR | CANCELLED`.
- `AgentJobManager.kt` — thread-safe job registry with scheduled cleanup after a
  retention window (default 5 min) so leaked jobs don't grow unbounded.
- `AgentJobExecutor.kt` — shared cached thread pool for all agent background work.
- `AgentJobResponse.kt` — helpers that build the JSON shape clients poll.
- `OpenAIClientConfig.kt` — single shared OpenAI client bean, configured from env.

### Frontend (UI / JS / CSS)
- `image-agent.js` — vanilla JS client. Fires the generate request, polls every
  3 s (up to 3 min), renders the preview thumbnail + full-size modal + save
  modal with custom filename input. Handles CSRF via meta tags. Exposes a
  small `window.ImageAgent` API so the host page can trigger generation.
- `image-agent.css` — styles for the preview, the "generating…" spinner, the
  full-size modal, the gradient "Vygenerovat obrázek" button, and mobile
  responsive tweaks.
- `chat.ftl` — FreeMarker template of the host chat modal. Shows the DOM IDs
  the JS looks for (`agent-generate-image-btn`, `agent-chat-messages`,
  `agent-message-input`, `agent-error-message`, `agent-error-text`) and how
  the CSS + JS are loaded with CSP nonces and a cache-busting version param.
  Use it as the structural contract when porting the UI to React.

## Key design decisions worth copying

1. **Job + polling, not streaming.** Image generation can take 10–60s. SSE and
   long-lived HTTP are fragile behind proxies. A `jobId` + 3 s poll is simple
   and robust. See the controller's `generate` + `getJobStatus` endpoints and
   `image-agent.js` `startImagePolling`.
2. **Two-phase save.** Generate → temp cache → user previews → explicit save to
   gallery. Prevents cluttering the gallery with discarded generations. The
   Caffeine cache with `expireAfterAccess` + removal listener deletes the temp
   file automatically if the user never saves.
3. **Per-session rate limiting.** A `ConcurrentHashMap<sessionId,
   List<timestamp>>` with a sliding window. Cheap, stateless across restarts,
   enough for a demo.
4. **Conditional bean wiring.** `@ConditionalOnBean(OpenAIClient::class)` means
   the feature silently disables itself if no API key is configured, rather
   than crashing boot. The Node equivalent: guard the route registration on
   `process.env.OPENAI_API_KEY`.
5. **User-facing error translation.** The controller maps OpenAI error strings
   (`"rate limit"`, `"content policy"`, `"timeout"`) to friendly messages.
   Copy this pattern — never leak raw SDK errors to the UI.
6. **Filename sanitization.** `sanitizeForFilename` in the agent collapses any
   non-`[a-zA-Z0-9-_]` into `-` before touching the filesystem. Do the same.

## OpenAI call — the important bit

```kotlin
val params = ImageGenerateParams.builder()
    .model(ImageModel.of(modelName))            // default: "gpt-image-1"
    .prompt(DEFAULT_PROMPT_PREFIX + prompt)      // "Create a high-quality, detailed image: ..."
    .n(1)
    .size(ImageGenerateParams.Size.of("1024x1024"))
    .quality(ImageGenerateParams.Quality.MEDIUM)
    .build()

val response = client.images().generate(params)
val base64 = response.data().get().first().b64Json().get()
val bytes  = Base64.getDecoder().decode(base64)
```

Note: `gpt-image-1` **always** returns base64 (no `response_format` parameter,
unlike DALL·E). The output format chosen is WebP at 1024×1024, medium quality
— good tradeoff between cost, speed, and fidelity for editor illustrations.

## Dependency reference (Kotlin side)

```groovy
// build.gradle
implementation("com.openai:openai-java:$openaiVersion")           // OpenAI SDK
implementation("com.github.ben-manes.caffeine:caffeine")           // TTL cache
implementation("com.sksamuel.scrimage:scrimage-webp:4.1.1")        // WebP encode
```

For the Node port, the equivalents are:
- `openai` (official SDK) — `openai.images.generate({ model, prompt, size, quality, n, response_format })`
  or the newer `responses.create` API
- `lru-cache` or `node-cache` for the TTL temp store (or just a `Map` + `setTimeout`)
- `sharp` for any WebP re-encoding / resizing

## FreeMarker template snippet (how the buttons are wired)

```html
<!-- from templates/articles/agent/chat.ftl -->
<button type="button" id="agent-generate-image-btn" class="btn btn-info"
        title="Vygenerovat obrázek pomocí AI">
  <i class="fas fa-palette"></i> Vygenerovat obrázek
</button>

<link rel="stylesheet" href="/static/css/image-agent.css">
<script src="/static/js/image-agent.js"></script>
```

## What to translate vs. what to keep

| Keep as-is                                    | Rewrite idiomatically                  |
|-----------------------------------------------|----------------------------------------|
| Two-phase generate → preview → save flow      | Spring beans → Express/Fastify routes  |
| `jobId` + 3 s polling loop on the client      | Caffeine cache → `lru-cache`           |
| Error-string → friendly-message mapping       | Session-based rate limit → IP or user  |
| Filename sanitization regex                   | CSRF meta-tag approach if using JWT    |
| `gpt-image-1` params (size / quality / n)     | FreeMarker `.ftl` → React/JSX         |
