// ============================================================
// youtube.js — load the IFrame API, parse URLs, wrap the player.
// ============================================================

let apiPromise = null;

// Load the YouTube IFrame API exactly once. The API signals readiness by
// calling the global window.onYouTubeIframeAPIReady, so we hook into that.
export function loadYouTubeAPI() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

// Accepts full URLs (watch, youtu.be, shorts, embed) or a bare 11-char ID.
export function parseVideoId(input) {
  if (!input) return null;
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;

  try {
    const url = new URL(raw.includes("://") ? raw : "https://" + raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (url.searchParams.get("v")) {
        const id = url.searchParams.get("v");
        return /^[\w-]{11}$/.test(id) ? id : null;
      }
      const m = url.pathname.match(/\/(embed|shorts|v)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {
    /* fall through */
  }
  return null;
}

// Thin wrapper around YT.Player with promise-based readiness.
export class Player {
  constructor(elementId) {
    this.elementId = elementId;
    this.yt = null;
    this.videoId = null;
    this._onState = null;
  }

  onStateChange(cb) {
    this._onState = cb;
  }

  async load(videoId) {
    await loadYouTubeAPI();
    this.videoId = videoId;

    if (this.yt) {
      this.yt.loadVideoById(videoId);
      this.yt.pauseVideo();
      return;
    }

    // origin + enablejsapi are required for the IFrame API (especially on
    // localhost). origin must match the page URL exactly, including port.
    const origin = location.origin && location.origin !== "null"
      ? location.origin
      : `${location.protocol}//${location.host}`;

    await new Promise((resolve, reject) => {
      this.yt = new YT.Player(this.elementId, {
        videoId,
        host: "https://www.youtube.com",
        playerVars: {
          enablejsapi: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          origin,
        },
        events: {
          onReady: () => resolve(),
          onError: (e) => reject(new Error("yt-error:" + e.data)),
          onStateChange: (e) => this._onState && this._onState(e.data),
        },
      });
    });
  }

  play() { this.yt && this.yt.playVideo(); }
  pause() { this.yt && this.yt.pauseVideo(); }
  seekTo(sec) { this.yt && this.yt.seekTo(sec, true); }
  getCurrentTime() { return this.yt ? this.yt.getCurrentTime() : 0; }
  getDuration() { return this.yt ? this.yt.getDuration() : 0; }
  getState() { return this.yt ? this.yt.getPlayerState() : -1; }
}

// Re-export the player-state enum values we care about (avoids depending on
// YT being defined at import time).
export const STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};
