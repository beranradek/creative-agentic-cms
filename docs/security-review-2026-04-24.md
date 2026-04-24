# Security review (Issue #3)

Date: 2026-04-24  
Scope: `packages/server`, `packages/web`, `packages/shared`, local filesystem project storage under `./projects/<projectId>/`

This codebase looks like an MVP intended for **local** use. There is **no authentication** and the server reads/writes content on disk, so treating it as an internet-exposed service would be unsafe without additional controls (reverse proxy auth, network restrictions, rate limiting, etc.).

## Key findings

### 1) Unauthenticated API + permissive CORS + broad bind defaults (HIGH)
**Impact:** If the server is reachable from a browser outside the local machine (e.g., bound to `0.0.0.0`, port-forwarded, or deployed), a malicious website could drive API calls from a victim’s browser and modify projects (or spam the agent endpoints).  
**Notes:** Prior configuration used `cors()` default (allow all origins) and `app.listen(PORT)` default host binding.

**Mitigation implemented in this PR:**
- Added `HOST` (default `127.0.0.1`) and `CORS_ORIGINS` allowlist (default `http://localhost:5173,http://127.0.0.1:5173`) in `packages/server/src/config.ts`.
- Updated CORS setup to only emit CORS headers for allowed origins.

**Further recommendations:**
- Add authentication (even simple token) for any non-local deployment.
- Add rate limiting / request throttling for `/api/projects/:id/agent/*` endpoints.
- Run behind a reverse proxy with IP allowlist and request size/time limits.

### 2) Path traversal / arbitrary file write via weak id validation (HIGH)
**Impact:** `AssetIdSchema` previously allowed arbitrary strings. Because `PUT /api/projects/:projectId/page` accepts client-controlled `assets[]`, an attacker could store an asset with an id containing path separators and then use `POST /assets/images/:assetId/replace` to write outside of `assets/` (path traversal via `path.join(assetsDir, filename)`).

**Mitigation implemented in this PR:**
- Tightened `AssetIdSchema`, `SectionIdSchema`, `ComponentIdSchema` to safe `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` in `packages/shared/src/page-schema.ts`.
- `replace` endpoint now parses `assetId` using `AssetIdSchema`.

### 3) Static exposure of project files (MEDIUM)
**Impact:** `app.use("/projects", express.static(dataDirAbs))` makes project content accessible over HTTP. That includes `page.json`, `output/`, and `.workspace/` artifacts (e.g. screenshots), which may contain sensitive content depending on how the tool is used.  
**Recommendation:** In production, serve only the exported site output, or gate `/projects` behind auth; consider disabling `.workspace` exposure.

### 4) Dependency / supply-chain risks (MEDIUM)
**Impact:** Standard Node.js ecosystem risk; without a CI audit policy, vulnerable transitive dependencies can land unnoticed.  
**Recommendation:** Add CI job for `pnpm audit` (or OSV-based scanning) and a Renovate/Dependabot policy.

## Notes on frontend XSS
`packages/web/src/ui/app.tsx` uses `dangerouslySetInnerHTML` for rich text, but it sanitizes user HTML (allowed tags + safe `href` protocol filter, strips attributes). That’s a reasonable approach for this MVP, but consider adding a CSP when serving the exported page on the web.

