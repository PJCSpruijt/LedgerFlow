import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite proxy target. Inside Docker compose, use the backend service hostname.
// On the host (running `npm run dev` outside Docker), defaults to localhost.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/auth": { target: apiTarget, changeOrigin: true },
      "/health": { target: apiTarget, changeOrigin: true },
    },
  },
});
