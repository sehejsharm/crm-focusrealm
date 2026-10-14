// Bundles the API with esbuild:
//   dist/index.js   long-running server (local / self-hosted)
//   dist/vercel.js  the Vercel serverless function (api/index.mjs re-exports it)
//   dist/scripts/seed.js
// npm dependencies stay external and load from node_modules at runtime.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"));

await build({
  absWorkingDir: here,
  entryPoints: ["src/index.ts", "src/vercel.ts", "src/scripts/seed.ts"],
  outdir: "dist",
  outbase: "src",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  logLevel: "warning",
  external: Object.keys(pkg.dependencies ?? {}),
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log("[build] api bundled → apps/api/dist");
