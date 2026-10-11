import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
const HTTPS_MODE = "https";
const HTTPS_PORT = 5443;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  // `npm run dev:https` serves over HTTPS with a self-signed certificate, for opening the app on a phone.
  const isHttps = mode === HTTPS_MODE;
  return {
    plugins: [react(), ...(isHttps ? [basicSsl()] : [])],
    server: {
      // Listen on the local network so a phone on the same Wi-Fi can open the app.
      host: true,
      port: isHttps ? HTTPS_PORT : 5173,
      strictPort: true,
      proxy: { "/api": { target: env.VITE_PROXY_TARGET || DEFAULT_BACKEND_URL, changeOrigin: true } },
    },
  };
});
