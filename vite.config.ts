import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { pwa } from "./build/pwa-vite-plugin";
import { sites } from "./build/sites-vite-plugin";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const packageVersion = JSON.parse(
  readFileSync(resolve(rootDir, "package.json"), "utf8"),
) as { version: string };
const buildChannel = process.env.OPENMOUSE_BUILD_CHANNEL ?? "beta";

/** Beta build version: major.minor from the package plus the build number
    (total commits on this history, monotonic per push). Falls back to a
    date-based number when git is unavailable (e.g. source archives). */
const versionBase = packageVersion.version.replace(/\.\d+$/, "");
function betaBuildVersion(): string {
  try {
    const number = execSync("git rev-list --count HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return `${versionBase}.${number}`;
  } catch {
    return `${versionBase}.${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  }
}
const buildId = buildChannel === "beta" ? betaBuildVersion() : "";

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
    __BUILD_ID__: JSON.stringify(buildId),
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
