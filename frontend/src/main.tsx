import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/figtree";
import "@fontsource/jersey-20/400.css";

import { App } from "./App";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element is missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
