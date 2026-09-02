import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Adds the Cloudflare Worker entry point required by the Sites host. */
export function sites({ target }: { target?: "app" | "landing" } = {}): Plugin {
  let root = process.cwd();
  let outputDirectory = "dist";

  return {
    name: "openmouse-sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outputDirectory = config.build.outDir;
    },
    async closeBundle() {
      const serverDirectory = resolve(root, outputDirectory, "server");

      await mkdir(serverDirectory, { recursive: true });
      await writeFile(
        resolve(serverDirectory, "index.js"),
        `export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
`,
      );

      // The "landing" target only builds landing.html (there's no
      // index.html in that deploy), so route the root request to it —
      // this is the Cloudflare Pages project served at openmouse.app.
      if (target === "landing") {
        await writeFile(
          resolve(root, outputDirectory, "_redirects"),
          "/    /landing.html   200\n",
        );
      }
    },
  };
}
