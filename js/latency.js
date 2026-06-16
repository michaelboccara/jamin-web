// Latency / sync offset — device-wide compensation for capture delay.

import { DEFAULT_LATENCY_OFFSET_SEC, STORAGE_KEYS } from "./constants.js";

const NUDGE_SEC = 0.01;
const MIN_OFFSET_SEC = -0.3;
const MAX_OFFSET_SEC = 0.8;

export function initLatencyOffset(app) {
  const { elements, engine } = app;
  const saved = parseFloat(localStorage.getItem(STORAGE_KEYS.latencyOffset));
  app.latencyOffset = Number.isFinite(saved) ? saved : DEFAULT_LATENCY_OFFSET_SEC;

  engine.setGlobalOffset(app.latencyOffset);
  renderOffsetReadout(app);

  elements.offsetEarlier?.addEventListener("click", (event) => {
    event.stopPropagation();
    nudgeOffset(app, NUDGE_SEC);
  });
  elements.offsetLater?.addEventListener("click", (event) => {
    event.stopPropagation();
    nudgeOffset(app, -NUDGE_SEC);
  });
  elements.offsetReadout?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOffset(app, DEFAULT_LATENCY_OFFSET_SEC);
  });
  elements.offsetReadout?.addEventListener("click", (event) => event.stopPropagation());
}

function clampOffset(seconds) {
  return Math.max(MIN_OFFSET_SEC, Math.min(MAX_OFFSET_SEC, seconds));
}

function nudgeOffset(app, deltaSeconds) {
  const next = Math.round((app.latencyOffset + deltaSeconds) * 1000) / 1000;
  setOffset(app, clampOffset(next));
}

function renderOffsetReadout(app) {
  if (!app.elements.offsetReadout) return;
  const milliseconds = Math.round(app.latencyOffset * 1000);
  app.elements.offsetReadout.textContent = `${milliseconds >= 0 ? "+" : ""}${milliseconds} ms`;
}

function setOffset(app, seconds, { persist = true } = {}) {
  app.latencyOffset = clampOffset(seconds);
  app.engine.setGlobalOffset(app.latencyOffset);
  renderOffsetReadout(app);
  app.redrawWaveforms?.();
  if (persist) localStorage.setItem(STORAGE_KEYS.latencyOffset, String(app.latencyOffset));
}
