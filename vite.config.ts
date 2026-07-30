import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

import { sites } from "./build/sites-vite-plugin";

const packageVersion = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as { version: string };
const buildChannel = process.env.OPENMOUSE_BUILD_CHANNEL ?? "insiders";

export default defineConfig({
  plugins: [sites()],
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion.version),
    __BUILD_CHANNEL__: JSON.stringify(buildChannel),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
        control: resolve(__dirname, "control.html"),
      },
    },
  },
});
