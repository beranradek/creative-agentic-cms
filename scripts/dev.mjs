import { spawn } from "node:child_process";

function spawnProc(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    if (signal) process.stderr.write(`[dev] ${name} exited (${signal})\n`);
    else if (code !== 0) process.stderr.write(`[dev] ${name} exited (code ${code})\n`);
  });
  return child;
}

function killProc(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 2000).unref();
}

async function runOnce(name, cmd, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
    child.on("exit", (code, signal) => {
      if (signal) return reject(new Error(`${name} exited (${signal})`));
      if (code !== 0) return reject(new Error(`${name} exited (code ${code})`));
      resolve();
    });
  });
}

async function main() {
  // Ensure dist/ exists before starting the Node server watcher.
  await runOnce("build", "pnpm", ["-r", "--filter", "@cac/shared", "--filter", "@cac/agent", "--filter", "@cac/server", "build"]);

  const procs = [
    spawnProc("shared:watch", "pnpm", ["--filter", "@cac/shared", "build:watch"]),
    spawnProc("agent:watch", "pnpm", ["--filter", "@cac/agent", "build:watch"]),
    spawnProc("server:watch", "pnpm", ["--filter", "@cac/server", "build:watch"]),
    spawnProc("server", "pnpm", ["--filter", "@cac/server", "dev:serve"]),
    spawnProc("web", "pnpm", ["--filter", "@cac/web", "dev"]),
  ];

  const shutdown = () => {
    process.stderr.write("\n[dev] shutting down...\n");
    for (const p of procs) killProc(p);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  process.stderr.write(`[dev] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
