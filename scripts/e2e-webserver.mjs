import { spawn } from "node:child_process";

const SERVER_URL = "http://localhost:5174/api/projects";
const WEB_URL = "http://localhost:4173/";

function spawnChild(command, args, options) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  return child;
}

async function waitForOk(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const server = spawnChild("node", ["--env-file=.env", "packages/server/dist/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env },
});

const web = spawnChild("pnpm", ["--filter", "@cac/web", "preview", "--port", "4173", "--strictPort"], {
  cwd: process.cwd(),
  env: { ...process.env },
});

const shutdown = () => {
  if (!server.killed) server.kill("SIGTERM");
  if (!web.killed) web.kill("SIGTERM");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.all([waitForOk(SERVER_URL, 60_000), waitForOk(WEB_URL, 60_000)]);

// Keep process alive for Playwright.
await new Promise(() => {});

