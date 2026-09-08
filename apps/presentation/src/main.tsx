import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@refrain/renderer/styles.css";
import { App } from "./App.js";
import "./shell.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
