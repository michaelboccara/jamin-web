// ============================================================
// main.js — wires UI ↔ player ↔ recorder ↔ db ↔ playback engine.
// ============================================================

import * as db from "./db.js";
import { Player, STATE, parseVideoId } from "./youtube.js";
import { Recorder, recordingSupportError } from "./recorder.js";
import { PlaybackEngine } from "./playback.js";
import { computePeaks, drawWaveform } from "./waveform.js";
import { buildZip, readZip } from "./zip.js";

// YouTube's official IFrame API demo — reliably embeds on localhost.
// const DEFAULT_VIDEO = "M7lc1UVf-VE";
const DEFAULT_VIDEO = "HY4lQ7vH4K4";
// Karaoke IDs often block embedding; skip these if cached from earlier versions.
const BLOCKED_VIDEO_IDS = new Set(["B3O1OlTWXSA", "HY4lQ7vH4K4", "PD6ippYQ434"]);
const LAST_VIDEO_KEY = "jamin:lastVideo";
const THEME_KEY = "jamin:theme";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  urlForm: $("urlForm"), urlInput: $("urlInput"),
  playBtn: $("playBtn"), recBtn: $("recBtn"), stopAllBtn: $("stopAllBtn"),
  timeReadout: $("timeReadout"), recIndicator: $("recIndicator"), recTimer: $("recTimer"),
  monitorChk: $("monitorChk"), rawMicChk: $("rawMicChk"),
  trackList: $("trackList"), emptyHint: $("emptyHint"),
  exportBtn: $("exportBtn"), importBtn: $("importBtn"), importFile: $("importFile"),
  themeBtn: $("themeBtn"), installBtn: $("installBtn"),
  overlay: $("playerOverlay"), overlayMsg: $("playerOverlayMsg"),
  toast: $("toast"),
};

// ---------- State ----------
const player = new Player("player");
const recorder = new Recorder();
const engine = new PlaybackEngine(() => player.getCurrentTime());

let currentVideoId = null;
let tracks = [];           // db records for the current video
let isRecording = false;
let recStartVideoTime = 0; // video currentTime when recording began
let recStartedAt = 0;      // epoch ms, for the on-screen rec timer
let uiTimer = null;

// ---------- Toast helper ----------
let toastTimer = null;
function toast(msg, kind = "") {
  els.toast.textContent = msg;
  els.toast.className = "toast" + (kind ? " " + kind : "");
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 4200);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------- Theme ----------
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  els.themeBtn.textContent = saved === "dark" ? "🌙" : "☀️";
}
els.themeBtn.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  els.themeBtn.textContent = next === "dark" ? "🌙" : "☀️";
  localStorage.setItem(THEME_KEY, next);
  redrawWaveforms();
});

// ---------- Video loading ----------
function describeYtError(code) {
  if (code === "101" || code === "150") {
    return "This video can't be embedded (uploader blocked it). Paste a different link — many karaoke channels disable embedding.";
  }
  if (code === "153") {
    return "YouTube rejected the embed (missing referrer). Open via http://localhost, not file://.";
  }
  if (code === "100") return "Video not found or removed.";
  if (code === "2") return "Invalid video ID.";
  return "Couldn't load this video.";
}

async function loadVideo(videoId, { persist = true } = {}) {
  els.urlInput.value = videoId;
  setOverlay("Loading player…");

  try {
    await player.load(videoId);
    setOverlay(null);
    currentVideoId = videoId;
    if (persist) localStorage.setItem(LAST_VIDEO_KEY, videoId);
    enableTransport(true);

    engine.clear();
    tracks = await db.getTracksByVideo(videoId);
    for (const t of tracks) await engine.addTrack(t);
    renderTracks();
    return true;
  } catch (err) {
    const code = String(err.message || "").split(":")[1];
    setOverlay(describeYtError(code));
    toast(describeYtError(code), "error");
    enableTransport(false);
    if (persist && localStorage.getItem(LAST_VIDEO_KEY) === videoId) {
      localStorage.removeItem(LAST_VIDEO_KEY);
    }
    return false;
  }
}

async function loadInitialVideo() {
  const saved = localStorage.getItem(LAST_VIDEO_KEY);
  if (saved && BLOCKED_VIDEO_IDS.has(saved)) {
    localStorage.removeItem(LAST_VIDEO_KEY);
  }
  const candidates = [
    saved && !BLOCKED_VIDEO_IDS.has(saved) ? saved : null,
    DEFAULT_VIDEO,
  ].filter(Boolean);

  for (const id of candidates) {
    const ok = await loadVideo(id);
    if (ok) {
      if (id === DEFAULT_VIDEO && saved !== DEFAULT_VIDEO) {
        toast("Demo video loaded. Paste a karaoke URL above — most karaoke channels block embedding.");
      }
      return;
    }
  }
}

function setOverlay(msg) {
  if (!msg) { els.overlay.hidden = true; return; }
  els.overlayMsg.textContent = msg;
  els.overlay.hidden = false;
}

function enableTransport(on) {
  const recBlocked = recordingSupportError();
  els.playBtn.disabled = !on;
  els.recBtn.disabled = !on || !!recBlocked;
  els.stopAllBtn.disabled = !on;
  els.recBtn.title = recBlocked || "Record a voice take while the video plays";
}

els.urlForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = parseVideoId(els.urlInput.value);
  if (!id) { toast("Couldn't find a video ID in that input.", "error"); return; }
  loadVideo(id);
});

// ---------- Transport ----------
els.playBtn.addEventListener("click", () => {
  const st = player.getState();
  if (st === STATE.PLAYING) player.pause();
  else player.play();
});

els.stopAllBtn.addEventListener("click", () => {
  if (isRecording) stopRecording();
  player.pause();
  engine.stop();
});

els.recBtn.addEventListener("click", async () => {
  if (isRecording) { await stopRecording(); return; }
  await startRecording();
});

els.rawMicChk.addEventListener("change", () => {
  recorder.setRawMic(els.rawMicChk.checked);
  if (els.rawMicChk.checked && els.monitorChk.checked) {
    els.monitorChk.checked = false;
    toast("Earphones mode turned off — it fights raw mic recording via browser echo cancellation.");
  }
});

els.monitorChk.addEventListener("change", () => {
  if (els.monitorChk.checked && els.rawMicChk.checked) {
    els.monitorChk.checked = false;
    toast("Uncheck raw mic first, or use headphones with browser processing enabled.");
  }
});

async function startRecording() {
  recorder.setRawMic(els.rawMicChk.checked);

  // Stop prior-track playback before opening the mic. Speaker output from
  // earphones mode makes the browser's echo-canceller duck/suppress the mic
  // even when raw-mic constraints are requested.
  engine.stop();
  if (els.rawMicChk.checked) recorder.resetMic();

  try {
    await recorder.ensureMic();
  } catch (err) {
    toast(err.message, "error");
    return;
  }
  player.play();
  await recorder.start();
  recStartVideoTime = player.getCurrentTime();
  recStartedAt = Date.now();
  isRecording = true;

  els.recBtn.textContent = "■ Stop take";
  els.recBtn.classList.add("is-recording");
  els.recIndicator.hidden = false;

  // Only monitor prior takes when explicitly enabled AND browser processing is on.
  // Raw mic + speaker playback = echo cancellation fights your recording.
  const monitorTakes = els.monitorChk.checked && !els.rawMicChk.checked;
  if (monitorTakes) engine.start();
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  els.recBtn.textContent = "● Record";
  els.recBtn.classList.remove("is-recording");
  els.recIndicator.hidden = true;

  let result;
  try {
    result = await recorder.stop();
  } catch {
    return;
  }
  const { blob, mimeType } = result;

  // Decode once to get accurate duration + waveform peaks.
  let duration = (Date.now() - recStartedAt) / 1000;
  let peaks = [];
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    duration = buf.duration;
    peaks = computePeaks(buf);
    ctx.close();
  } catch {
    /* keep elapsed-time fallback, empty peaks */
  }

  const track = {
    videoId: currentVideoId,
    name: `Take ${tracks.length + 1}`,
    startTime: recStartVideoTime,
    duration,
    mimeType,
    volume: 1,
    muted: false,
    peaks,
    createdAt: Date.now(),
    blob,
  };
  const id = await db.addTrack(track);
  track.id = id;
  tracks.push(track);
  tracks.sort((a, b) => a.startTime - b.startTime);
  await engine.addTrack(track);
  renderTracks();
  toast("Take saved.", "success");
}

// ---------- Player state → engine ----------
player.onStateChange((state) => {
  if (state === STATE.PLAYING) {
    els.playBtn.textContent = "❚❚ Pause";
    // While recording with raw mic (default), never play prior takes — speaker
    // bleed triggers browser echo cancellation that alters the new take.
    if (isRecording && (els.rawMicChk.checked || !els.monitorChk.checked)) {
      engine.stop();
    } else {
      engine.start();
    }
    startUiLoop();
  } else if (state === STATE.PAUSED) {
    els.playBtn.textContent = "▶︎ Play";
    engine.stop();
    if (isRecording) stopRecording();
    stopUiLoop();
  } else if (state === STATE.ENDED) {
    els.playBtn.textContent = "▶︎ Play";
    engine.stop();
    if (isRecording) stopRecording();
    stopUiLoop();
  } else if (state === STATE.BUFFERING) {
    // Pause audio during buffering; the watchdog re-syncs on resume.
    engine.stop();
  }
});

function startUiLoop() {
  if (uiTimer) return;
  uiTimer = setInterval(() => {
    els.timeReadout.textContent = fmtTime(player.getCurrentTime());
    if (isRecording) {
      els.recTimer.textContent = fmtTime((Date.now() - recStartedAt) / 1000);
    }
  }, 250);
}
function stopUiLoop() {
  clearInterval(uiTimer);
  uiTimer = null;
}

// ---------- Track list rendering ----------
function renderTracks() {
  els.trackList.innerHTML = "";
  els.emptyHint.hidden = tracks.length > 0;

  for (const t of tracks) {
    const li = document.createElement("li");
    li.className = "track";

    // Header row: editable name + time range
    const row = document.createElement("div");
    row.className = "track-row";

    const name = document.createElement("input");
    name.className = "track-name";
    name.value = t.name;
    name.title = "Rename take";
    name.addEventListener("change", async () => {
      t.name = name.value.trim() || t.name;
      name.value = t.name;
      await db.updateTrack(stripBlobless(t));
    });

    const time = document.createElement("span");
    time.className = "track-time";
    time.textContent = `${fmtTime(t.startTime)} · ${t.duration ? t.duration.toFixed(1) : "?"}s`;

    row.append(name, time);

    // Waveform preview
    const canvas = document.createElement("canvas");
    canvas.className = "waveform";
    canvas._peaks = t.peaks;

    // Controls row
    const controls = document.createElement("div");
    controls.className = "track-controls";

    const playOne = mkIconBtn("▶", "Preview this take", () => previewTrack(t, playOne));
    const mute = mkIconBtn(t.muted ? "🔇" : "🔊", "Mute in mix", () => toggleMute(t, mute));
    if (t.muted) mute.classList.add("active");

    const vol = document.createElement("input");
    vol.type = "range";
    vol.className = "vol";
    vol.min = "0"; vol.max = "1"; vol.step = "0.01";
    vol.value = String(t.volume ?? 1);
    vol.title = "Volume in mix";
    vol.addEventListener("input", async () => {
      t.volume = parseFloat(vol.value);
      engine.setVolume(t.id, t.volume);
    });
    vol.addEventListener("change", () => db.updateTrack(stripBlobless(t)));

    const del = mkIconBtn("🗑", "Delete take", () => deleteTrackUI(t));
    del.classList.add("danger");

    controls.append(playOne, mute, vol, del);

    li.append(row, canvas, controls);
    els.trackList.append(li);

    // Draw after layout so clientWidth is known.
    requestAnimationFrame(() => drawWaveform(canvas, t.peaks, accentColor()));
  }
}

function mkIconBtn(label, title, onClick) {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function accentColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#6c8cff";
}

function redrawWaveforms() {
  els.trackList.querySelectorAll("canvas.waveform").forEach((c) => {
    drawWaveform(c, c._peaks, accentColor());
  });
}

// db.updateTrack stores the whole record (blob included), which is fine.
function stripBlobless(t) { return t; }

// ---------- Per-track actions ----------
let previewAudio = null;
function previewTrack(t, btn) {
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  const url = URL.createObjectURL(t.blob);
  previewAudio = new Audio(url);
  previewAudio.play();
  btn.classList.add("active");
  previewAudio.onended = () => { btn.classList.remove("active"); URL.revokeObjectURL(url); };
}

function toggleMute(t, btn) {
  t.muted = !t.muted;
  btn.textContent = t.muted ? "🔇" : "🔊";
  btn.classList.toggle("active", t.muted);
  engine.setMuted(t.id, t.muted);
  db.updateTrack(stripBlobless(t));
}

async function deleteTrackUI(t) {
  if (!confirm(`Delete "${t.name}"?`)) return;
  await db.deleteTrack(t.id);
  engine.removeTrack(t.id);
  tracks = tracks.filter((x) => x.id !== t.id);
  renderTracks();
  toast("Take deleted.");
}

// ---------- Export / Import ----------
els.exportBtn.addEventListener("click", async () => {
  if (!tracks.length) { toast("No tracks to export for this video."); return; }
  const meta = { videoId: currentVideoId, exportedAt: Date.now(), version: 1, tracks: [] };
  const entries = [];
  let i = 0;
  for (const t of tracks) {
    const ext = (t.mimeType || "").includes("ogg") ? "ogg"
      : (t.mimeType || "").includes("mp4") ? "m4a" : "webm";
    const file = `audio/${i}.${ext}`;
    entries.push({ name: file, data: new Uint8Array(await t.blob.arrayBuffer()) });
    meta.tracks.push({
      file, name: t.name, startTime: t.startTime, duration: t.duration,
      mimeType: t.mimeType, volume: t.volume, muted: t.muted, peaks: t.peaks,
      createdAt: t.createdAt,
    });
    i++;
  }
  entries.push({ name: "metadata.json", data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) });

  const zip = buildZip(entries);
  const url = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jamin-${currentVideoId}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Exported.", "success");
});

els.importBtn.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files[0];
  els.importFile.value = "";
  if (!file) return;
  try {
    const files = await readZip(file);
    const metaBytes = files["metadata.json"];
    if (!metaBytes) throw new Error("metadata.json missing");
    const meta = JSON.parse(new TextDecoder().decode(metaBytes));
    const targetVideo = meta.videoId || currentVideoId;

    for (const m of meta.tracks) {
      const bytes = files[m.file];
      if (!bytes) continue;
      const blob = new Blob([bytes], { type: m.mimeType || "audio/webm" });
      const track = {
        videoId: targetVideo, name: m.name || "Imported take",
        startTime: m.startTime || 0, duration: m.duration || 0,
        mimeType: m.mimeType || "audio/webm", volume: m.volume ?? 1,
        muted: !!m.muted, peaks: m.peaks || [], createdAt: m.createdAt || Date.now(),
        blob,
      };
      await db.addTrack(track);
    }
    toast("Imported.", "success");
    if (targetVideo === currentVideoId) {
      await loadVideo(currentVideoId); // refresh list + engine
    } else if (confirm("Imported takes belong to a different video. Load it now?")) {
      await loadVideo(targetVideo);
    }
  } catch (err) {
    toast("Import failed: " + err.message, "error");
  }
});

// ---------- PWA: install prompt + service worker ----------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.installBtn.hidden = false;
});
els.installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.installBtn.hidden = true;
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {/* offline cache optional */});
  });
}

// ---------- Boot ----------
initTheme();
showRecordingSupport();
loadInitialVideo();
window.addEventListener("resize", () => redrawWaveforms());

function showRecordingSupport() {
  const err = recordingSupportError();
  if (err) toast(err, "error");
}
