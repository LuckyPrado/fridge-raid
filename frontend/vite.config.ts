import { existsSync, readFileSync } from "node:fs";

import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
const HTTPS_MODE = "https";
const HTTPS_PORT = 5443;
// A certificate made for this laptop's network address (see README). Phones reject one that names another host.
const CERT_FILE = ".cert/cert.pem";
const KEY_FILE = ".cert/key.pem";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  // `npm run dev:https` serves over HTTPS with a self-signed certificate, for opening the app on a phone.
  const isHttps = mode === HTTPS_MODE;
  const hasOwnCert = isHttps && existsSync(CERT_FILE) && existsSync(KEY_FILE);
  return {
    plugins: [react(), ...(isHttps && !hasOwnCert ? [basicSsl()] : [])],
    server: {
      // Listen on the local network so a phone on the same Wi-Fi can open the app.
      host: true,
      port: isHttps ? HTTPS_PORT : 5173,
      strictPort: true,
      https: hasOwnCert ? { cert: readFileSync(CERT_FILE), key: readFileSync(KEY_FILE) } : undefined,
      proxy: { "/api": { target: env.VITE_PROXY_TARGET || DEFAULT_BACKEND_URL, changeOrigin: true } },
    },
  };
});
