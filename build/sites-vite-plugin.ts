/**
 * Cloudflare Pages serves this app's `functions/` directory (Pages Functions,
 * not a standalone Worker — see `functions/_middleware.js` and
 * `CF_PAGES_COMMIT_SHA` in vite.config.ts). Pages expects static output at
 * the dist root, so this plugin only emits the `dist/server/index.js` ASSETS
 * passthrough shim for tooling that probes a Worker-style entrypoint. It
 * performs no routing and must stay dependency-free.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export function sites(): Plugin {
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
    },
  };
}
