// PWA install prompt and offline service worker registration.

import { reportWarning } from "./errors.js";

export function initPwa(app) {
  // The custom install button was removed with the top bar; browsers still
  // expose their own native install affordance. Capture the prompt anyway in
  // case a button is reintroduced, and degrade gracefully when it's absent.
  const installBtn = app.elements.installBtn;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    app.deferredInstallPrompt = event;
    if (installBtn) installBtn.hidden = false;
  });

  installBtn?.addEventListener("click", async () => {
    if (!app.deferredInstallPrompt) return;
    app.deferredInstallPrompt.prompt();
    await app.deferredInstallPrompt.userChoice;
    app.deferredInstallPrompt = null;
    installBtn.hidden = true;
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((error) => {
        reportWarning("serviceWorker.register", error);
      });
    });
  }
}
