// Latency / sync offset slider — device-wide compensation for capture delay.

import { DEFAULT_LATENCY_OFFSET_SEC, STORAGE_KEYS } from "./constants.js";

export function initLatencyOffset(app) {
  const { elements, engine } = app;
  const saved = parseFloat(localStorage.getItem(STORAGE_KEYS.latencyOffset));
  app.latencyOffset = Number.isFinite(saved) ? saved : DEFAULT_LATENCY_OFFSET_SEC;

  if (elements.offsetRange) elements.offsetRange.value = String(app.latencyOffset);
  engine.setGlobalOffset(app.latencyOffset);
  renderOffsetReadout(app);

  elements.offsetRange?.addEventListener("input", () => {
    setOffset(app, parseFloat(elements.offsetRange.value), { persist: false });
  });
  elements.offsetRange?.addEventListener("change", () => {
    setOffset(app, parseFloat(elements.offsetRange.value));
  });
  elements.offsetReset?.addEventListener("click", () => {
    setOffset(app, DEFAULT_LATENCY_OFFSET_SEC);
  });
}

function renderOffsetReadout(app) {
  if (!app.elements.offsetReadout) return;
  const milliseconds = Math.round(app.latencyOffset * 1000);
  app.elements.offsetReadout.textContent = `${milliseconds >= 0 ? "+" : ""}${milliseconds} ms`;
}

function setOffset(app, seconds, { persist = true } = {}) {
  app.latencyOffset = seconds;
  if (app.elements.offsetRange) app.elements.offsetRange.value = String(seconds);
  app.engine.setGlobalOffset(seconds);
  renderOffsetReadout(app);
  if (persist) localStorage.setItem(STORAGE_KEYS.latencyOffset, String(seconds));
}
