// YouTube video loading and metadata capture.

import * as db from "./db.js";
import { BLOCKED_VIDEO_IDS, DEFAULT_VIDEO_ID, STORAGE_KEYS } from "./constants.js";
import { reportError, reportWarning } from "./errors.js";
import { setPlayerOverlay, showToast } from "./ui.js";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function describeYouTubeError(code) {
  if (code === "101" || code === "150") {
    return "This video can't be embedded (uploader blocked it). Try another link — many karaoke channels disable embedding.";
  }
  if (code === "153") {
    return "YouTube rejected the embed (missing referrer). Open via http://localhost, not file://.";
  }
  if (code === "100") return "Video not found or removed.";
  if (code === "2") return "Invalid video ID.";
  return "Couldn't load this video.";
}

export async function loadVideo(app, videoId, { persist = true } = {}) {
  const { elements, player, engine, notify } = app;
  setPlayerOverlay(elements, "Loading player…");

  try {
    await player.load(videoId);
    setPlayerOverlay(elements, null);
    app.currentVideoId = videoId;
    if (persist) localStorage.setItem(STORAGE_KEYS.lastVideo, videoId);
    enableRecordButton(app, true);

    engine.clear();
    app.tracks = await db.getTracksByVideo(videoId);
    for (const track of app.tracks) await engine.addTrack(track);
    app.renderTracks();
    captureVideoMeta(app, videoId);
    return true;
  } catch (error) {
    const code = String(error.message || "").split(":")[1];
    const message = describeYouTubeError(code);
    reportError("loadVideo", error, message, notify);
    setPlayerOverlay(elements, message);
    enableRecordButton(app, false);
    if (persist && localStorage.getItem(STORAGE_KEYS.lastVideo) === videoId) {
      localStorage.removeItem(STORAGE_KEYS.lastVideo);
    }
    return false;
  }
}

export async function loadInitialVideo(app) {
  const saved = localStorage.getItem(STORAGE_KEYS.lastVideo);
  if (saved && BLOCKED_VIDEO_IDS.has(saved)) {
    localStorage.removeItem(STORAGE_KEYS.lastVideo);
  }

  const candidates = [
    saved && !BLOCKED_VIDEO_IDS.has(saved) ? saved : null,
    DEFAULT_VIDEO_ID,
  ].filter(Boolean);

  for (const videoId of candidates) {
    const loaded = await loadVideo(app, videoId);
    if (loaded) {
      if (videoId === DEFAULT_VIDEO_ID && saved !== DEFAULT_VIDEO_ID) {
        app.notify("Demo video loaded. Search or paste a karaoke URL — many channels block embedding.");
      }
      return;
    }
  }
}

export function enableRecordButton(app, enabled) {
  const blocked = app.recordingSupportError();
  app.elements.recBtn.disabled = !enabled || !!blocked;
  app.elements.recBtn.title = blocked || "Record a voice take while the video plays";
}

// Best-effort title/author for the history dropdown. getVideoData() is empty
// briefly after load, so poll; fall back to YouTube oEmbed.
export async function captureVideoMeta(app, videoId) {
  const { player, currentVideoId } = app;
  let title = "";
  let author = "";

  if (currentVideoId === videoId) {
    for (let attempt = 0; attempt < 15; attempt++) {
      if (currentVideoId !== videoId) return;
      const data = player.getVideoData?.();
      if (data?.title) {
        title = data.title;
        author = data.author || "";
        break;
      }
      await sleep(200);
    }
  }

  if (!title) {
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`
      );
      if (response.ok) {
        const json = await response.json();
        title = json.title || "";
        author = json.author_name || "";
      }
    } catch (error) {
      reportWarning("captureVideoMeta", "oEmbed fallback failed", error);
    }
  }

  try {
    await db.putVideoMeta({ videoId, title, author, updatedAt: Date.now() });
    app.renderHistory();
  } catch (error) {
    reportError("captureVideoMeta", error, null, app.notify);
  }
}
