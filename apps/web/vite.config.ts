import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In development the Worker runs on :8787 (npm run dev:worker); proxy API and WebSocket calls to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", ws: true },
      "/ws": { target: "http://127.0.0.1:8787", ws: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
