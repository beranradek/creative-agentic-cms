# Plan: Generate Image Feature

## 1. Plan Overview

Add an AI-powered "Generate image" button to the editor's Assets palette tab.  
Clicking it opens a modal dialog with a text-area prompt, size selector, and quality selector.  
On submit, the server calls OpenAI `gpt-image-1` asynchronously (job + 3 s polling), returns a preview, and on user confirmation saves the generated image as a new asset in the project's assets folder (same pipeline as upload).  
The implementation follows the blueprint in `docs/examples/imagegen/README.md`, translated to Node/TypeScript + React.

**Key design decisions (from blueprint):**
- Job + polling (not streaming) — robust behind proxies, survives 10–60 s generation time
- Two-phase flow: generate → temp preview → explicit "Save to assets" — keeps gallery clean
- TTL in-memory cache (`Map` + `setTimeout`) for temp images — no extra dependency
- Per-IP rate limiting: 5 requests/min sliding window — `Map<ip, timestamp[]>`
- Graceful disable if `OPENAI_API_KEY` is absent (guard at route registration)
- Friendly error messages — never leak raw SDK errors

---

## 2. Context

- **Spec:** `docs/plans/active/2026-04-27-imagegen/spec.md`
- **Blueprint:** `docs/examples/imagegen/README.md` — read fully before implementation
- **Example Kotlin service:** `docs/examples/imagegen/ImageGeneratingAgent.kt`
- **Example controller:** `docs/examples/imagegen/ImageGeneratingAgentController.kt`
- **Example job plumbing:** `AgentJob.kt`, `AgentJobManager.kt`, `AgentJobExecutor.kt`, `AgentJobResponse.kt`, `JobStatus.kt`
- **Example frontend:** `docs/examples/imagegen/image-agent.js`, `image-agent.css`, `chat.ftl`
- **Existing asset upload:** `packages/server/src/routes/assets.ts`
- **Existing agent:** `packages/agent/src/cms-agent.ts` — shows LangChain/OpenAI patterns
- **Shared types:** `packages/shared/src/page-schema.ts` (`ImageAssetSchema`, `AssetIdSchema`)
- **Server entry:** `packages/server/src/index.ts` — where new router is registered
- **Server config:** `packages/server/src/config.ts` — env schema (add `IMAGEGEN_MODEL`)
- **Web UI:** `packages/web/src/ui/app.tsx` — Assets tab (lines ~2038–2150) for button placement
- **OpenAI Node SDK docs:** https://platform.openai.com/docs/api-reference/images/create  
  Relevant: `openai.images.generate({ model, prompt, n, size, quality, response_format: 'b64_json' })`

---

## 3. Project Directories & Architecture Changes

### New files
| File | Purpose |
|------|---------|
| `packages/server/src/imagegen/image-gen-agent.ts` | Core service: calls OpenAI, stores temp image, two-phase save |
| `packages/server/src/imagegen/job-manager.ts` | In-memory job registry with cleanup |
| `packages/server/src/imagegen/types.ts` | `JobStatus` enum, `Job` interface, response shapes |
| `packages/server/src/routes/imagegen.ts` | Express router: generate, poll, temp-serve, save |

### Modified files
| File | Change |
|------|--------|
| `packages/server/src/config.ts` | Add `IMAGEGEN_MODEL` (default `gpt-image-1`) |
| `packages/server/src/index.ts` | Register `createImagegenRouter` under `/api/projects/:projectId/imagegen` |
| `packages/web/src/ui/app.tsx` | Add "Generate image" button + `GenerateImageDialog` modal component |
| `packages/web/src/ui/styles.css` | Dialog/spinner styles |

### No new packages needed
- `openai` SDK is already transitively available via `@langchain/openai` — but the raw `openai` npm package is cleaner for `images.generate`. Check if already present: it is a peer dep of `@langchain/openai`. Use `import OpenAI from 'openai'` or call via `fetch` + env key if SDK not directly available.
  - **Decision:** Use `fetch` directly to `https://api.openai.com/v1/images/generations` with `Authorization: Bearer ${OPENAI_API_KEY}` to avoid adding a new package and stay within KISS/YAGNI. This is straightforward and avoids dependency churn.

---

## 4. Important Implementation Patterns

### 4.1 Backend — Types (`imagegen/types.ts`)

```typescript
export type JobStatus = "processing" | "completed" | "error" | "cancelled";

export interface ImageGenJob {
  id: string;            // crypto.randomUUID()
  status: JobStatus;
  tempImageId?: string;  // set when completed
  error?: string;        // user-friendly message
  createdAt: number;
}

export interface TempImage {
  filename: string;      // e.g. img_<uuid>.webp
  buffer: Buffer;
  mimeType: string;      // "image/webp" or "image/png"
  width: number;
  height: number;
  createdAt: number;
}

// API response shapes
export interface GenerateResponse { jobId: string; }
export interface JobStatusResponse { jobId: string; status: JobStatus; tempImageId?: string; error?: string; }
```

### 4.2 Backend — Job Manager (`imagegen/job-manager.ts`)

- `Map<string, ImageGenJob>` for jobs; scheduled `setInterval` cleanup at 5 min retention
- `Map<string, TempImage>` for temp images; TTL via `setTimeout` (20 min) deletes entry
- `Map<string, number[]>` for per-IP rate limiting (5/min sliding window)
- All operations synchronous (no DB), thread-safe enough for single-process Node

### 4.3 Backend — Image Gen Agent (`imagegen/image-gen-agent.ts`)

```typescript
// POST https://api.openai.com/v1/images/generations
// Ref: https://platform.openai.com/docs/api-reference/images/create
// model: "gpt-image-1", prompt: string, n: 1, size: "1024x1024"|"1024x1536"|"1536x1024", quality: "low"|"medium"|"high"
// response_format not needed for gpt-image-1 (always returns b64_json in data[0].b64_json)
async function generateImage(prompt: string, size: ImageSize, quality: ImageQuality): Promise<TempImage>
```

Decode `b64_json` → `Buffer` → store in temp cache, return `tempImageId`.

### 4.4 Backend — Route (`routes/imagegen.ts`)

```
POST   /api/projects/:projectId/imagegen/generate
       Body: { prompt, size, quality }
       → { jobId }  (kicks off background Promise)

GET    /api/projects/:projectId/imagegen/job/:jobId
       → { jobId, status, tempImageId?, error? }

GET    /api/projects/:projectId/imagegen/temp/:tempImageId
       → binary image (serves buffer with correct Content-Type)

POST   /api/projects/:projectId/imagegen/save/:tempImageId
       Body: { alt? }
       → { asset } (same shape as upload endpoint)
```

The `save` endpoint moves the temp image buffer into `store.getAssetsDir(projectId)`, creates an `ImageAsset` and returns it. The calling React code then updates the page state (adds to `page.assets`) in the same way as `apiUploadImage` does.

### 4.5 Frontend — GenerateImageDialog modal

New React component `GenerateImageDialog` rendered conditionally in `app.tsx`:

```tsx
interface GenerateImageDialogProps {
  projectId: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}
```

**Form fields:**
- Textarea: prompt (required, max 1000 chars)
- Select: size — `1024x1024` (Square), `1024x1536` (Portrait), `1536x1024` (Landscape)
- Select: quality — `low`, `medium` (default), `high`

**Workflow:**
1. Submit → `POST .../imagegen/generate` → get `jobId`
2. Poll `GET .../imagegen/job/:jobId` every 3 s (up to 3 min timeout)
3. On `completed`: show `<img src=".../imagegen/temp/:tempImageId">` preview + "Save to Assets" button + "Discard" button
4. On "Save": `POST .../imagegen/save/:tempImageId` → get `asset` → call `onSaved(asset)` → close dialog
5. `onSaved` in `app.tsx` adds asset to `page.assets` (same as `uploadImageAssetOnly`)

**Error handling:** Show friendly error message from server response; allow retry.

### 4.6 Frontend — Button placement

In the Assets palette tab (around line 2063 in `app.tsx`), add a "Generate image" button next to the upload input:

```tsx
<button
  className="btn"
  disabled={!canEdit || !openaiConfigured}
  onClick={() => setShowGenerateDialog(true)}
  data-testid="generate-image-btn"
>
  Generate image
</button>
```

`openaiConfigured` flag: a new API endpoint `GET /api/health` (or reuse existing) returns whether imagegen is available. Simpler: just always show button and handle 503 error gracefully.

---

## 5. Implementation Steps

### Task 1: Backend types and job manager

**Files:** `packages/server/src/imagegen/types.ts`, `packages/server/src/imagegen/job-manager.ts`

1. Create `types.ts` with `JobStatus`, `ImageGenJob`, `TempImage`, response interfaces
2. Create `job-manager.ts`:
   - `JobManager` class with jobs map, tempImages map, rate-limit map
   - `createJob(): ImageGenJob`
   - `updateJob(id, patch): void`
   - `getJob(id): ImageGenJob | undefined`
   - `storeTempImage(id, img): void` — schedules 20 min TTL cleanup
   - `getTempImage(id): TempImage | undefined`
   - `checkRateLimit(ip): boolean` — 5/min sliding window, returns `true` if allowed
   - `startCleanup(): void` — `setInterval` every 5 min to remove old jobs

**Criteria:**
- `completeness` (8): All methods implemented, no TODOs
- `correctness` (8): Rate limit correctly counts in 60 s window; TTL cleanup fires
- `verification_steps` (8): Unit test covering rate limit (allow 5, block 6th, allow after window)
- `error_handling` (6): Missing job returns `undefined` gracefully
- `no_memory_leak` (7): Jobs cleaned after 5 min, temp images after 20 min — verify cleanup runs

**Verification:**
```bash
pnpm --filter @cac/server test
```

---

### Task 2: Image generation agent service

**File:** `packages/server/src/imagegen/image-gen-agent.ts`

1. `generateImage(prompt, size, quality, apiKey)` async function:
   - Validates prompt length (≤ 1000 chars)
   - Calls `POST https://api.openai.com/v1/images/generations` with `fetch`
   - Decodes `b64_json` → `Buffer`
   - Sanitizes filename: `img_<uuid>.webp` (gpt-image-1 always returns PNG-compatible, store as `.png`)
   - Returns `TempImage`
2. Error mapping: `"rate_limit_exceeded"` → "Rate limit reached, try again in a moment.", `"content_policy_violation"` → "Prompt was rejected by content policy.", other → "Image generation failed, try again."

**Criteria:**
- `completeness` (8): fetch call, b64 decode, TempImage returned
- `correctness` (8): Correct OpenAI request body; response correctly parsed
- `verification_steps` (8): Integration test with mocked fetch (vitest `vi.stubGlobal('fetch', ...)`)
- `error_handling` (6): All 3 error types mapped to friendly messages
- `openai_api_compliance` (8): Request matches https://platform.openai.com/docs/api-reference/images/create — model, prompt, n=1, size, quality fields correct
- `filename_sanitized` (7): Output filename contains only `[a-zA-Z0-9._-]`

**Verification:**
```bash
pnpm --filter @cac/server test
```

---

### Task 3: Express route

**File:** `packages/server/src/routes/imagegen.ts`

1. Implement `createImagegenRouter(options)`:
   - Creates `JobManager` instance (shared singleton passed in or created per-router)
   - Guards entire registration on `!!process.env.OPENAI_API_KEY` — returns disabled router with 503 if missing
   - `POST .../generate`: validate body (`prompt` string ≤1000, `size` enum, `quality` enum), check rate limit, create job, fire `generateImage` in background Promise (`.then` updates job), return `{ jobId }`
   - `GET .../job/:jobId`: return job status
   - `GET .../temp/:tempImageId`: serve temp image buffer with `Content-Type`
   - `POST .../save/:tempImageId`: read temp image, write to assets dir, parse dimensions with `image-size`, construct `ImageAsset`, update `page.assets` via `store.writePageIfMatch`, return `{ asset }`

2. Register router in `packages/server/src/index.ts`:
   ```typescript
   import { createImagegenRouter } from './routes/imagegen.js';
   app.use('/api/projects/:projectId/imagegen', createImagegenRouter({ store, projectIdSchema: ProjectIdSchema }));
   ```

3. Update `packages/server/src/config.ts` to add `IMAGEGEN_MODEL` (default `"gpt-image-1"`).

**Criteria:**
- `completeness` (8): All 4 endpoints implemented
- `correctness` (8): Save correctly writes file, updates page.assets via store, returns valid `ImageAsset`
- `verification_steps` (8): Manual curl test of all 4 endpoints; integration test of save flow
- `error_handling` (6): 503 when no API key; 429 on rate limit; 404 for missing job/temp
- `rate_limit_enforced` (8): 6th request within 1 min returns HTTP 429
- `save_idempotent` (7): Saving same tempImageId twice returns 404 on second call (temp deleted after save)

**Verification:**
```bash
# Build
pnpm --filter @cac/server build
# Test
pnpm --filter @cac/server test
```

---

### Task 4: Frontend dialog component and button

**Files:** `packages/web/src/ui/app.tsx`, `packages/web/src/ui/styles.css`

1. Add state: `const [showGenerateDialog, setShowGenerateDialog] = useState(false);`

2. Add `GenerateImageDialog` React component (can be at bottom of `app.tsx` with other modal components like `ImageEditorModal`):
   - Props: `projectId`, `onClose`, `onSaved(asset: Asset): void`
   - Internal state: `prompt`, `size` (default `"1024x1024"`), `quality` (default `"medium"`), `phase: "form" | "generating" | "preview" | "saving" | "error"`, `tempImageId`, `jobId`, `errorMsg`
   - Form phase: textarea + selects + "Generate" button
   - Generating phase: spinner + "Cancel" (just closes dialog)
   - Preview phase: `<img>` thumbnail + "Save to Assets" + "Discard" buttons
   - Error phase: error message + "Try again" button

3. Add 3 API helper functions near existing `apiUploadImage`:
   ```typescript
   async function apiGenerateImage(projectId, prompt, size, quality): Promise<{ jobId: string }>
   async function apiPollImageJob(projectId, jobId): Promise<{ status, tempImageId?, error? }>
   async function apiSaveGeneratedImage(projectId, tempImageId, alt?): Promise<Asset>
   ```

4. In the Assets tab (around line 2062), add the "Generate image" button next to the upload `<input>`.

5. Render `<GenerateImageDialog>` conditionally at the same level as `<ImageEditorModal>` (around line 3013).

6. In `onSaved(asset)`: update page state with the new asset (no section/component insertion — asset only, just like `uploadImageAssetOnly`).

7. Add minimal CSS to `styles.css`:
   - `.generateDialog` overlay (fixed, z-index 1000, backdrop blur)
   - `.generateDialogCard` (white card, max-width 540px)
   - `.spinner` animation (reuse existing if any, or simple keyframe)

**Criteria:**
- `completeness` (8): All 3 phases (form→generating→preview) render correctly
- `correctness` (8): Saved asset appears in assets list; page.assets updated
- `verification_steps` (8): E2E test: open dialog, fill form, mock generation returns asset
- `error_handling` (6): Network error during poll shows error message; retry works
- `polling_stops` (7): Polling clears its interval on unmount / dialog close
- `accessibility` (7): Dialog has role="dialog", buttons have accessible labels, textarea has label

**Verification:**
```bash
pnpm --filter @cac/web build
pnpm --filter @cac/web test  # unit tests
```

---

### Task 5: Integration + E2E verification

1. Run full build: `pnpm build`
2. Run all tests: `pnpm test`
3. Start app with `./start.sh`, navigate to `http://localhost:5173`
4. Open Assets tab → verify "Generate image" button visible
5. Click button → dialog opens with form
6. Fill prompt, select size/quality, click Generate
7. Observe spinner → preview appears → click "Save to Assets"
8. Verify asset appears in Assets list and persists after page reload
9. Test error case: empty prompt → button disabled / validation message
10. Check browser console for zero JS errors

**Criteria:**
- `completeness` (8): All steps 3–10 pass
- `correctness` (8): Saved asset appears in UI and in `projects/<id>/assets/` filesystem
- `verification_steps` (8): Screenshot taken at each step
- `error_handling` (6): Error state displays and allows retry
- `no_console_errors` (8): Browser console clean throughout workflow
- `asset_persists` (8): Asset present after server restart

---

## 6. Security Considerations

- **Rate limiting:** Per-IP 5 requests/min prevents prompt abuse and OpenAI cost overruns
- **Prompt validation:** Max 1000 chars; no other injection risk (pure text sent to OpenAI)
- **Filename sanitization:** Generated filename is `img_<uuid>.webp` — UUID only, no user input in path
- **API key:** Never returned to client; only accessed server-side via `process.env`
- **No auth on endpoints:** Consistent with rest of the demo (no auth system exists); acceptable for demo scope
- **Temp image TTL:** 20 min auto-cleanup prevents unbounded memory growth

---

## 7. Questions / Uncertainties

1. **`openai` package availability:** `@langchain/openai` depends on `openai` SDK transitively. Rather than relying on transitive dep, use `fetch` directly (KISS). Confirm via `pnpm why openai` during implementation.
2. **`image-size` on Buffer:** `image-size` accepts `Buffer` — works for PNG/WebP/JPEG. For `gpt-image-1` output (always PNG), this is fine.
3. **Insert generated image as section:** The spec says "generate image as new asset" — Answer: but also insert it into page as new image section, please.
