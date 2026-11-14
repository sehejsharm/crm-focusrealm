import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The main text font is needed for the very first paint. Naming it in the
 * HTML lets the browser fetch it alongside the CSS, not after reading it.
 */
function preloadMainFont(): Plugin {
  return {
    name: "preload-main-font",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find((file) => /\/geist-latin-wght-normal[^/]*\.woff2$/.test(`/${file}`));
        if (!font) return [];
        return [{ tag: "link", attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${font}`, crossorigin: "" }, injectTo: "head" }];
      },
    },
  };
}

const inPackages = (...names: string[]) => new RegExp(`[\\\\/]node_modules[\\\\/](${names.join("|")})[\\\\/]`);

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadMainFont()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // The libraries change rarely; the app's own code changes on every
        // release. Kept in separate files, a browser that has visited before
        // re-downloads only the app's part after an update.
        codeSplitting: {
          groups: [
            { name: "react", test: inPackages("react", "react-dom", "scheduler", "react-router", "react-router-dom"), priority: 30 },
            { name: "motion", test: inPackages("motion", "motion-dom", "motion-utils", "framer-motion"), priority: 20 },
            { name: "query", test: inPackages("@tanstack"), priority: 20 },
          ],
        },
      },
    },
  },
});
