import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// In development the page is served by Vite and the API by the studio server
// (`comms ui <project>`), so /api is proxied to it.
export default defineConfig({
  plugins: [react()],
  server: { port: 4401, proxy: { "/api": "http://127.0.0.1:4400" } },
  build: { outDir: "dist", emptyOutDir: true },
})
