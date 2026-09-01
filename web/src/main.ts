import { render } from "./app.ts";
import { startDatadog } from "./observability/datadog.ts";
import { startSentry } from "./observability/sentry.ts";
import { startWebUpdatePrompt } from "./sw-update.ts";

function showBootError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const root = document.getElementById("app");
  if (root) root.textContent = message;
}

try {
  startSentry();
  startDatadog();
  render();
  startWebUpdatePrompt();
} catch (error) {
  showBootError(error);
  throw error;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
