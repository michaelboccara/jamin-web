// Advanced gear popover: sync offset lives here; nudge + raw-mic toggles.

import { STORAGE_KEYS } from "./constants.js";
import { setRawMicOverride } from "./audio-devices.js";

export function initAdvanced({ elements, bus, trackList, settings }) {
  const savedNudge = localStorage.getItem(STORAGE_KEYS.nudge) === "on";
  applyNudge(elements, savedNudge);
  if (elements.advNudgeChk) elements.advNudgeChk.checked = savedNudge;

  elements.advancedBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (elements.advancedPanel.hidden) openAdvanced(elements);
    else closeAdvanced(elements);
  });

  elements.advNudgeChk?.addEventListener("change", () => {
    applyNudge(elements, elements.advNudgeChk.checked);
    trackList.layoutAllTrackRows();
  });

  elements.advRawMic?.addEventListener("change", () => {
    setRawMicOverride(settings, elements.advRawMic.value);
  });

  document.addEventListener("click", (event) => {
    if (elements.advancedPanel.hidden) return;
    if (!elements.advancedPanel.contains(event.target)
      && event.target !== elements.advancedBtn) {
      closeAdvanced(elements);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAdvanced(elements);
  });

  bus.on("timeline:ready", () => trackList.layoutAllTrackRows());
}

function applyNudge(elements, enabled) {
  document.documentElement.dataset.nudge = enabled ? "on" : "off";
  localStorage.setItem(STORAGE_KEYS.nudge, enabled ? "on" : "off");
  if (elements.advNudgeChk) {
    elements.advNudgeChk.checked = enabled;
  }
}

function openAdvanced(elements) {
  elements.advancedPanel.hidden = false;
  elements.advancedBtn.setAttribute("aria-expanded", "true");
}

function closeAdvanced(elements) {
  elements.advancedPanel.hidden = true;
  elements.advancedBtn.setAttribute("aria-expanded", "false");
}
