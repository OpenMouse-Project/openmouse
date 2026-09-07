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
const buildChannel = process.env.OPENMOUSE_BUILD_CHANNEL ?? "beta";

export default defineConfig({
  plugins: [sites(), pwa(packageVersion.version)],
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
      input: {
        main: resolve(__dirname, "index.html"),
        // Gated stats dashboard for the operator (password-protected via
        // functions/api/admin/*, not linked from anywhere in the UI) —
        // lives on control.openmouse.app alongside the app.
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
