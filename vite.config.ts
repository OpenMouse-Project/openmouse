import { defineConfig } from "vite";

import { sites } from "./build/sites-vite-plugin";

export default defineConfig({
  plugins: [sites()],
});
