// ============================================================
// playback.js — Web Audio engine that keeps recorded voice tracks
// in sync with the YouTube video.
//
// -------------------- SYNC MODEL --------------------
// The YouTube player and the Web Audio clock (AudioContext.currentTime)
// are two independent timelines. To sync them we keep a single "anchor"
// that maps one to the other at a known instant:
//
//     videoTime  ≈  anchorVideo + (audioCtx.currentTime - anchorAudio)
//
// When the video starts playing we record the anchor, then schedule every
// clip relative to it:
//
//     clip should sound at videoTime == clip.startTime
//     => audioStartAt = anchorAudio + (clip.startTime - anchorVideo)
//
// A clip already "in progress" at anchor time is started immediately with
// an intra-clip offset of (anchorVideo - clip.startTime).
//
// -------------------- DRIFT FIXES --------------------
// Drift sources: buffering hiccups, the user seeking, and slow clock skew
// between the media element and the audio hardware. We run a watchdog tick
// (4×/sec) that compares the *expected* video time (from the anchor) with
// the *actual* player.getCurrentTime():
//
//   * |error| > SEEK_THRESHOLD  -> treat as a seek/jump: stop everything,
//                                  re-anchor, and reschedule from scratch.
//   * |error| > DRIFT_THRESHOLD -> gentle slip: re-anchor without tearing
//                                  down already-playing sources (they're
//                                  close enough; the new anchor keeps future
//                                  clips honest).
//
// This keeps long sessions tight without audible re-triggering on tiny skew.
// ============================================================

const SEEK_THRESHOLD = 0.6;  // seconds — bigger than this == a jump/seek
const DRIFT_THRESHOLD = 0.18; // seconds — gentle re-anchor above this
const TICK_MS = 250;

export class PlaybackEngine {
  constructor(getVideoTime) {
    this.getVideoTime = getVideoTime; // () => current player time in seconds
    this.ctx = null;
    this.tracks = []; // [{ id, buffer, startTime, gainNode, volume, muted }]
    this.active = new Map(); // id -> AudioBufferSourceNode currently playing
    this.anchorAudio = 0;
    this.anchorVideo = 0;
    this.running = false;
    this.timer = null;
  }

  _ctxReady() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  // Decode a stored track's blob into an AudioBuffer once and cache it.
  async addTrack(track) {
    const ctx = this._ctxReady();
    const arrayBuf = await track.blob.arrayBuffer();
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(arrayBuf.slice(0));
    } catch {
      // Some opus-in-webm blobs fail decodeAudioData on certain browsers.
      // Skip rather than break the whole mix.
      return null;
    }
    const gainNode = ctx.createGain();
    gainNode.gain.value = track.muted ? 0 : (track.volume ?? 1);
    gainNode.connect(ctx.destination);

    const entry = {
      id: track.id,
      buffer,
      startTime: track.startTime,
      gainNode,
      volume: track.volume ?? 1,
      muted: !!track.muted,
    };
    this.tracks.push(entry);
    // If we're already playing, fold the new track into the running mix.
    if (this.running) this._scheduleOne(entry);
    return entry;
  }

  setVolume(id, volume) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    t.volume = volume;
    if (!t.muted) t.gainNode.gain.value = volume;
  }

  setMuted(id, muted) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    t.muted = muted;
    t.gainNode.gain.value = muted ? 0 : t.volume;
  }

  removeTrack(id) {
    this._stopOne(id);
    this.tracks = this.tracks.filter((t) => t.id !== id);
  }

  clear() {
    this.stop();
    this.tracks = [];
  }

  // (Re)establish the anchor from the current video time.
  _anchor() {
    this.anchorAudio = this.ctx.currentTime;
    this.anchorVideo = this.getVideoTime();
  }

  _expectedVideoTime() {
    return this.anchorVideo + (this.ctx.currentTime - this.anchorAudio);
  }

  _scheduleOne(entry) {
    this._stopOne(entry.id); // never double-schedule
    const now = this.ctx.currentTime;
    const videoNow = this._expectedVideoTime();
    const dur = entry.buffer.duration;
    const clipEnd = entry.startTime + dur;

    if (clipEnd <= videoNow) return; // clip is fully in the past

    const src = this.ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.connect(entry.gainNode);
    src.onended = () => {
      if (this.active.get(entry.id) === src) this.active.delete(entry.id);
    };

    if (entry.startTime <= videoNow) {
      // Already mid-clip: start now, skipping into the buffer.
      const offset = videoNow - entry.startTime;
      src.start(now, Math.max(0, offset));
    } else {
      // Future clip: schedule precisely on the shared timeline.
      const when = this.anchorAudio + (entry.startTime - this.anchorVideo);
      src.start(Math.max(now, when));
    }
    this.active.set(entry.id, src);
  }

  _scheduleAll() {
    for (const t of this.tracks) this._scheduleOne(t);
  }

  _stopOne(id) {
    const src = this.active.get(id);
    if (src) {
      try { src.onended = null; src.stop(); } catch { /* already stopped */ }
      this.active.delete(id);
    }
  }

  _stopAllSources() {
    for (const id of [...this.active.keys()]) this._stopOne(id);
  }

  // Called when the video starts playing.
  start() {
    const ctx = this._ctxReady();
    if (this.running) return;
    this.running = true;
    this._anchor();
    this._scheduleAll();
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  // Watchdog: correct drift / detect seeks.
  _tick() {
    if (!this.running) return;
    const expected = this._expectedVideoTime();
    const actual = this.getVideoTime();
    const error = actual - expected;

    if (Math.abs(error) > SEEK_THRESHOLD) {
      // The user seeked (or a big stall): rebuild the mix at the new position.
      this._stopAllSources();
      this._anchor();
      this._scheduleAll();
    } else if (Math.abs(error) > DRIFT_THRESHOLD) {
      // Gentle skew: re-anchor so future scheduling stays accurate, and make
      // sure any clip that *should* be sounding now actually is.
      this._anchor();
      for (const t of this.tracks) {
        const videoNow = this.anchorVideo;
        const within = t.startTime <= videoNow && t.startTime + t.buffer.duration > videoNow;
        if (within && !this.active.has(t.id)) this._scheduleOne(t);
      }
    }
  }

  // Called when the video pauses/ends/buffers.
  stop() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this._stopAllSources();
  }
}
