// Runs the API and the web app side by side for local development.
import { spawn } from "node:child_process";

const procs = [
  ["api", ["run", "dev", "-w", "apps/api"]],
  ["web", ["run", "dev", "-w", "apps/web"]],
].map(([name, args]) => {
  const p = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const tag = name === "api" ? "\x1b[34m[api]\x1b[0m" : "\x1b[36m[web]\x1b[0m";
  for (const s of [p.stdout, p.stderr]) s.on("data", (d) => process.stdout.write(String(d).replace(/^/gm, `${tag} `)));
  p.on("exit", (code) => { console.log(`${tag} exited with ${code}`); process.exit(code ?? 0); });
  return p;
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { procs.forEach((p) => p.kill(sig)); process.exit(0); });
