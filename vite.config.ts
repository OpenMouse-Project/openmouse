import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

import { sites } from "./build/sites-vite-plugin";

const packageVersion = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as { version: string };
const buildChannel = process.env.OPENMOUSE_BUILD_CHANNEL ?? "insiders";

// Tauri-specific settings below only take effect when `tauri dev`/`tauri build`
// invoke Vite; a plain `npm run dev`/`npm run build` for the web target ignores
// them (TAURI_ENV_* is only set inside the Tauri CLI's child process).
const isTauriBuild = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [sites()],
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion.version),
    __BUILD_CHANNEL__: JSON.stringify(buildChannel),
  },
  // Don't let Vite clear the terminal on rebuild — we want to see Rust
  // compiler errors from `tauri dev` scroll by, not have them wiped.
  clearScreen: false,
  server: {
    port: 5173,
    // Tauri's tauri.conf.json build.devUrl is a fixed http://localhost:5173.
    // Fail instead of silently moving to 5174+ if the port is taken, so the
    // desktop shell doesn't load against nothing.
    strictPort: true,
    watch: {
      // The Rust toolchain owns src-tauri/target; don't let Vite's watcher
      // (or `tauri dev`'s own rebuild-on-change) fight over it and loop.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // Recommended Tauri + Vite settings: target the webview's actual engine
    // instead of a generic browserslist, and only keep sourcemaps / skip
    // minification for Tauri's own debug builds.
    target: isTauriBuild ? ["es2021", "chrome100", "safari13"] : undefined,
    minify: isTauriBuild ? !process.env.TAURI_ENV_DEBUG : true,
    sourcemap: isTauriBuild ? !!process.env.TAURI_ENV_DEBUG : false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
        control: resolve(__dirname, "control.html"),
        controlApp: resolve(__dirname, "control-app.html"),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === "controlApp"
          ? "protected-assets/control-[hash].js"
          : "assets/[name]-[hash].js",
      },
    },
  },
});
