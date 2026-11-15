import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// The dev server forwards API and file requests to the backend, so the page and its data share
// one address: viewers on the network need only this port, and the backend can stay on
// localhost. Used when VITE_API_URL is empty; a full URL there bypasses the proxy.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    host: true,
    proxy: {
      "/api": BACKEND_URL,
      "/files": BACKEND_URL,
    },
  },
})
