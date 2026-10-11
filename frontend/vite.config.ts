import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { "/api": { target: env.VITE_PROXY_TARGET || DEFAULT_BACKEND_URL, changeOrigin: true } },
    },
  };
});
