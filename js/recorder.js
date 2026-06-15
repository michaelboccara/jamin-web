// ============================================================
// recorder.js — voice capture via MediaRecorder.
//
// Picks the best available webm/opus mime type and reuses the mic stream
// across takes. The caller is responsible for tagging the resulting blob
// with the video timestamp at which recording started.
// ============================================================

const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4", // Safari
];

// Returns why recording is unavailable, or null if it should work.
export function recordingSupportError() {
  if (!window.isSecureContext) {
    return "Microphone needs a secure page. Open http://localhost:PORT in Chrome, Edge, or Firefox — not file://.";
  }
  if (!getUserMediaFn()) {
    return "Microphone capture isn't available in this browser. Use Chrome, Edge, or Firefox (not an embedded preview panel).";
  }
  if (typeof MediaRecorder === "undefined") {
    return "MediaRecorder isn't supported in this browser. Try Chrome, Edge, or Firefox.";
  }
  return null;
}

// Polyfill navigator.mediaDevices.getUserMedia for older / partial implementations.
function getUserMediaFn() {
  if (navigator.mediaDevices?.getUserMedia) {
    return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
  }
  const legacy =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia;
  if (legacy) {
    return (constraints) =>
      new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
  }
  return null;
}

export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return ""; // let the browser choose its default
}

export class Recorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.mimeType = "";
  }

  // Lazily request mic permission; throws a friendly error if denied.
  async ensureMic() {
    if (this.stream && this.stream.active) return this.stream;

    const blocked = recordingSupportError();
    if (blocked) throw new Error(blocked);

    const getUserMedia = getUserMediaFn();
    try {
      this.stream = await getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        throw new Error("Microphone permission was denied. Allow it in the browser address bar, then try again.");
      }
      if (err && err.name === "NotFoundError") {
        throw new Error("No microphone was found on this device.");
      }
      if (err && err.name === "NotReadableError") {
        throw new Error("Microphone is in use by another app. Close it and try again.");
      }
      throw err;
    }
    return this.stream;
  }

  async start() {
    await this.ensureMic();
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder isn't supported in this browser.");
    }
    this.mimeType = pickMimeType();
    this.chunks = [];
    this.recorder = new MediaRecorder(
      this.stream,
      this.mimeType ? { mimeType: this.mimeType } : undefined
    );
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250); // gather data in small timeslices
  }

  // Resolves with the recorded Blob (and the mime type actually used).
  stop() {
    return new Promise((resolve, reject) => {
      if (!this.recorder || this.recorder.state === "inactive") {
        reject(new Error("Not recording."));
        return;
      }
      this.recorder.onstop = () => {
        const type = this.mimeType || "audio/webm";
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        resolve({ blob, mimeType: type });
      };
      this.recorder.stop();
    });
  }

  get isRecording() {
    return !!this.recorder && this.recorder.state === "recording";
  }

  releaseMic() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }
}
