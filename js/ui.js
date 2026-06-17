// UI helpers: toast, theme, overlay, formatting.

let toastTimer = null;

export function bindElements() {
  const byId = (id) => document.getElementById(id);
  return {
    searchForm: byId("searchForm"),
    searchInput: byId("searchInput"),
    searchResults: byId("searchResults"),
    logoBtn: byId("logoBtn"),
    advancedBtn: byId("advancedBtn"),
    advancedPanel: byId("advancedPanel"),
    advNudgeChk: byId("advNudgeChk"),
    advRawMic: byId("advRawMic"),
    recBtn: byId("recBtn"),
    recIndicator: byId("recIndicator"),
    recTimer: byId("recTimer"),
    offsetEarlier: byId("offsetEarlier"),
    offsetReadout: byId("offsetReadout"),
    offsetLater: byId("offsetLater"),
    timelinePanel: byId("timelinePanel"),
    timelineRulerStart: byId("timelineRulerStart"),
    timelineRulerEnd: byId("timelineRulerEnd"),
    trackList: byId("trackList"),
    playhead: byId("playhead"),
    emptyHint: byId("emptyHint"),
    historyPanel: byId("historyPanel"),
    historyList: byId("historyList"),
    historyEmpty: byId("historyEmpty"),
    exportBtn: byId("exportBtn"),
    importBtn: byId("importBtn"),
    shareBtn: byId("shareBtn"),
    importFile: byId("importFile"),
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

// Theme always follows the OS. An inline script in index.html sets the initial
// value before first paint; here we just keep it in sync if the OS toggles.
export function initTheme() {
  const media = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

  const setTheme = (isLight) =>
    document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");

  setTheme(media ? media.matches : false);

  media?.addEventListener?.("change", (event) => {
    setTheme(event.matches);
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
