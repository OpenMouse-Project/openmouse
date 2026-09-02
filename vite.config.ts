import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { pwa } from "./build/pwa-vite-plugin";
import { sites } from "./build/sites-vite-plugin";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const packageVersion = JSON.parse(
  readFileSync(resolve(rootDir, "package.json"), "utf8"),
) as { version: string };
const buildChannel = process.env.OPENMOUSE_BUILD_CHANNEL ?? "insiders";
// Two Cloudflare Pages projects deploy from this same repo: the default
// "app" target builds the gated control app (control.openmouse.app), and
// "landing" builds the standalone marketing page (openmouse.app). See
// build/sites-vite-plugin.ts for the _redirects file that routes "landing"
// deploys' root request to landing.html.
const buildTarget = process.env.OPENMOUSE_BUILD_TARGET ?? "app";

export default defineConfig({
  plugins: [sites({ target: buildTarget }), pwa(packageVersion.version, buildTarget)],
  resolve: {
    // Prefix aliases, so react-dom/client and react/jsx-runtime follow too.
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion.version),
    __BUILD_CHANNEL__: JSON.stringify(buildChannel),
  },
  build: {
    rollupOptions: {
      input:
        buildTarget === "landing"
          ? {
              // These four are public support/info pages that belong on the
              // marketing domain, not just the gated control app — the
              // landing page itself links out to all of them.
              landing: resolve(__dirname, "landing.html"),
              check: resolve(__dirname, "check.html"),
              supported: resolve(__dirname, "supported.html"),
              donate: resolve(__dirname, "donate.html"),
              contribute: resolve(__dirname, "contribute.html"),
            }
          : {
              main: resolve(__dirname, "index.html"),
              check: resolve(__dirname, "check.html"),
              supported: resolve(__dirname, "supported.html"),
              donate: resolve(__dirname, "donate.html"),
              contribute: resolve(__dirname, "contribute.html"),
            },
    },
  },
});
