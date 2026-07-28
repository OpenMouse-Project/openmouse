import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Adds the Cloudflare Worker entry point required by the Sites host. */
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "openmouse-sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const serverDirectory = resolve(root, "dist", "server");

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
    },
  };
}
