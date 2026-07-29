import { defineConfig } from "vite";
import { resolve } from "node:path";

import { sites } from "./build/sites-vite-plugin";

export default defineConfig({
  plugins: [sites()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
      },
    },
  },
});
