// PWA install prompt and offline service worker registration.

import { reportWarning } from "./errors.js";

export function initPwa(app) {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    app.deferredInstallPrompt = event;
    app.elements.installBtn.hidden = false;
  });

  app.elements.installBtn.addEventListener("click", async () => {
    if (!app.deferredInstallPrompt) return;
    app.deferredInstallPrompt.prompt();
    await app.deferredInstallPrompt.userChoice;
    app.deferredInstallPrompt = null;
    app.elements.installBtn.hidden = true;
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((error) => {
        reportWarning("serviceWorker.register", error);
      });
    });
  }
}
