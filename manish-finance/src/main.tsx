import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

const el = document.getElementById("finance-root");
if (el) {
  el.replaceChildren();
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
