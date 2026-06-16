// UI helpers: toast, theme, overlay, formatting.

import { STORAGE_KEYS } from "./constants.js";

let toastTimer = null;

export function bindElements() {
  const byId = (id) => document.getElementById(id);
  return {
    searchForm: byId("searchForm"),
    searchInput: byId("searchInput"),
    searchBtn: byId("searchBtn"),
    searchResults: byId("searchResults"),
    recBtn: byId("recBtn"),
    recIndicator: byId("recIndicator"),
    recTimer: byId("recTimer"),
    monitorTakesChk: byId("monitorTakesChk"),
    rawMicChk: byId("rawMicChk"),
    offsetEarlier: byId("offsetEarlier"),
    offsetReadout: byId("offsetReadout"),
    offsetLater: byId("offsetLater"),
    timelinePanel: byId("timelinePanel"),
    timelineRulerStart: byId("timelineRulerStart"),
    timelineRulerEnd: byId("timelineRulerEnd"),
    trackList: byId("trackList"),
    playhead: byId("playhead"),
    emptyHint: byId("emptyHint"),
    historyBtn: byId("historyBtn"),
    historyPanel: byId("historyPanel"),
    historyList: byId("historyList"),
    historyEmpty: byId("historyEmpty"),
    exportBtn: byId("exportBtn"),
    importBtn: byId("importBtn"),
    importFile: byId("importFile"),
    themeBtn: byId("themeBtn"),
    installBtn: byId("installBtn"),
    overlay: byId("playerOverlay"),
    overlayMsg: byId("playerOverlayMsg"),
    toast: byId("toast"),
    keepTakeModal: byId("keepTakeModal"),
    keepTakeYes: byId("keepTakeYes"),
    keepTakeNo: byId("keepTakeNo"),
    deleteTakeModal: byId("deleteTakeModal"),
    deleteTakeYes: byId("deleteTakeYes"),
    deleteTakeNo: byId("deleteTakeNo"),
  };
}

export function showToast(elements, message, kind = "") {
  elements.toast.textContent = message;
  elements.toast.className = "toast" + (kind ? " " + kind : "");
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (elements.toast.hidden = true), 4200);
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
  ));
}

export function getAccentColor() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim() || "#6c8cff";
}

export function setPlayerOverlay(elements, message) {
  if (!message) {
    elements.overlay.hidden = true;
    return;
  }
  elements.overlayMsg.textContent = message;
  elements.overlay.hidden = false;
}

export function initTheme(elements) {
  const saved = localStorage.getItem(STORAGE_KEYS.theme) || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  elements.themeBtn.textContent = saved === "dark" ? "🌙" : "☀️";

  elements.themeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    elements.themeBtn.textContent = next === "dark" ? "🌙" : "☀️";
    localStorage.setItem(STORAGE_KEYS.theme, next);
    window.dispatchEvent(new CustomEvent("jamin:theme-changed"));
  });
}

export function makeIconButton(label, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn";
  button.textContent = label;
  button.title = title;
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

let deleteConfirmPending = false;

export function confirmDeleteTake(elements) {
  if (deleteConfirmPending) return Promise.resolve(false);
  return new Promise((resolve) => {
    deleteConfirmPending = true;
    elements.deleteTakeModal.hidden = false;

    const finish = (confirmed) => {
      deleteConfirmPending = false;
      elements.deleteTakeModal.hidden = true;
      elements.deleteTakeYes.removeEventListener("click", onYes);
      elements.deleteTakeNo.removeEventListener("click", onNo);
      backdrop?.removeEventListener("click", onNo);
      document.removeEventListener("keydown", onKey);
      resolve(confirmed);
    };

    const onYes = () => finish(true);
    const onNo = () => finish(false);
    const onKey = (event) => {
      if (event.key === "Escape") finish(false);
    };

    const backdrop = elements.deleteTakeModal.querySelector(".modal-backdrop");
    elements.deleteTakeYes.addEventListener("click", onYes);
    elements.deleteTakeNo.addEventListener("click", onNo);
    backdrop?.addEventListener("click", onNo);
    document.addEventListener("keydown", onKey);
    elements.deleteTakeNo.focus();
  });
}
