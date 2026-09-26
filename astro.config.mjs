import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";

export default defineConfig({
  site: "https://together0624lyx.com",
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  integrations: [svelte()],
  vite: {
    server: { watch: { ignored: ["**/test-results/**"] } },
    plugins: [{
      name: "memory-detail-shell",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (/^\/memory\/[0-9a-f-]{36}\/?(?:\?|$)/i.test(req.url ?? "")) req.url = "/memory/";
          next();
        });
      },
    }],
  },
});
