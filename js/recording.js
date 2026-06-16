// Recording session: mic capture tied to YouTube playback state.

import * as db from "./db.js";
import { SEEK_DETECT_SEC } from "./constants.js";
import { reportError } from "./errors.js";
import { formatTime } from "./ui.js";
import { computePeaks } from "./waveform.js";
import { enableRecordButton } from "./video.js";
import { STATE } from "./youtube.js";

export function initRecording(app) {
  const { elements } = app;

  elements.recBtn.addEventListener("click", async () => {
    if (app.keepTakePending) return;
    if (app.isRecording) await finalizeRecording(app, { pausePlayer: true });
    else await startRecording(app);
  });

  elements.rawMicChk.addEventListener("change", () => {
    app.recorder.setRawMic(elements.rawMicChk.checked);
  });

  elements.monitorTakesChk.addEventListener("change", () => {
    if (!app.isRecording) return;
    syncMonitorDuringRecording(app);
  });

  app.player.onStateChange((state) => onPlayerStateChange(app, state));
}

function onPlayerStateChange(app, state) {
  if (state === STATE.PLAYING) {
    if (app.isRecording && app.isRecordingPaused) resumeRecordingSession(app);
    syncMonitorDuringRecording(app);
    startRecordingUiLoop(app);
  } else if (state === STATE.PAUSED) {
    app.engine.stop();
    if (app.isRecording && !app.isRecordingPaused) pauseRecordingSession(app);
    if (app.isRecording) startRecordingUiLoop(app);
    else stopRecordingUiLoop(app);
  } else if (state === STATE.ENDED) {
    app.engine.stop();
    if (app.isRecording) finalizeRecording(app, { pausePlayer: false });
    stopRecordingUiLoop(app);
  } else if (state === STATE.BUFFERING) {
    app.engine.stop();
  }
}

function syncMonitorDuringRecording(app) {
  if (app.isRecording && !app.elements.monitorTakesChk.checked) {
    app.engine.stop();
  } else {
    app.engine.start();
  }
}

async function startRecording(app) {
  if (app.keepTakePending) return;

  const { elements, recorder, engine, player } = app;
  recorder.setRawMic(elements.rawMicChk.checked);

  // Stop prior-track playback before opening the mic — speaker bleed triggers
  // browser echo cancellation even when raw-mic constraints are requested.
  engine.stop();
  if (elements.rawMicChk.checked) recorder.resetMic();

  try {
    await recorder.ensureMic();
  } catch (error) {
    app.notify(error.message, "error");
    return;
  }

  player.play();
  app.recStartVideoTime = player.getCurrentTime();
  app.recActiveMs = 0;
  app.recSegmentStartedAt = Date.now();
  app.lastVideoTime = app.recStartVideoTime;
  app.isRecordingPaused = false;
  await recorder.start();
  app.isRecording = true;

  elements.recBtn.textContent = "■ Stop take";
  elements.recBtn.classList.add("is-recording");
  elements.recIndicator.hidden = false;
  elements.recIndicator.innerHTML = `● REC <span id="recTimer">0:00</span>`;
  elements.recTimer = document.getElementById("recTimer");

  syncMonitorDuringRecording(app);
}

function pauseRecordingSession(app) {
  if (!app.isRecording || app.isRecordingPaused) return;
  markRecordingSegmentEnd(app);
  app.recorder.pause();
  app.isRecordingPaused = true;
  app.elements.recIndicator.textContent = "⏸ Paused";
}

function resumeRecordingSession(app) {
  if (!app.isRecording || !app.isRecordingPaused) return;
  app.recorder.resume();
  app.isRecordingPaused = false;
  app.recSegmentStartedAt = Date.now();
  app.elements.recIndicator.innerHTML =
    `● REC <span id="recTimer">${formatTime(recordingElapsedSec(app))}</span>`;
  app.elements.recTimer = document.getElementById("recTimer");
}

function markRecordingSegmentEnd(app) {
  if (app.recSegmentStartedAt) {
    app.recActiveMs += Date.now() - app.recSegmentStartedAt;
    app.recSegmentStartedAt = 0;
  }
}

function recordingElapsedSec(app) {
  let milliseconds = app.recActiveMs;
  if (app.recSegmentStartedAt) milliseconds += Date.now() - app.recSegmentStartedAt;
  return milliseconds / 1000;
}

export async function finalizeRecording(app, { pausePlayer = false } = {}) {
  if (!app.isRecording || app.finalizingRecording) return;
  app.finalizingRecording = true;
  app.isRecording = false;
  app.isRecordingPaused = false;

  const { elements, recorder, engine, player } = app;
  elements.recBtn.textContent = "● Record";
  elements.recBtn.classList.remove("is-recording");
  elements.recIndicator.hidden = true;

  if (pausePlayer) player.pause();
  engine.stop();
  stopRecordingUiLoop(app);
  markRecordingSegmentEnd(app);
  app.lastVideoTime = null;

  let result;
  try {
    result = await recorder.stop();
  } catch (error) {
    reportError("finalizeRecording", error, null, app.notify);
    app.finalizingRecording = false;
    return;
  }

  const { blob, mimeType } = result;
  let duration = recordingElapsedSec(app);
  let peaks = [];

  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await audioContext.decodeAudioData((await blob.arrayBuffer()).slice(0));
    duration = buffer.duration;
    peaks = computePeaks(buffer);
    audioContext.close();
  } catch (error) {
    reportError("finalizeRecording.decode", error, null, app.notify);
  }

  const keep = await confirmKeepTake(app);
  app.finalizingRecording = false;
  if (!keep) {
    app.notify("Take discarded.");
    return;
  }

  const track = {
    videoId: app.currentVideoId,
    name: `Take ${app.tracks.length + 1}`,
    startTime: app.recStartVideoTime,
    offset: 0,
    duration,
    mimeType,
    volume: 1,
    muted: false,
    peaks,
    createdAt: Date.now(),
    blob,
  };

  try {
    track.id = await db.addTrack(track);
    app.tracks.push(track);
    app.tracks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    await app.engine.addTrack(track);
    app.renderTracks();
    app.renderHistory();
    app.notify("Take saved.", "success");
  } catch (error) {
    reportError("finalizeRecording.save", error, "Could not save this take.", app.notify);
  }
}

function confirmKeepTake(app) {
  const { elements } = app;
  return new Promise((resolve) => {
    app.keepTakePending = true;
    elements.recBtn.disabled = true;
    elements.keepTakeModal.hidden = false;

    const finish = (keep) => {
      app.keepTakePending = false;
      elements.keepTakeModal.hidden = true;
      app.enableRecordButton(!!app.currentVideoId);
      elements.keepTakeYes.removeEventListener("click", onYes);
      elements.keepTakeNo.removeEventListener("click", onNo);
      document.removeEventListener("keydown", onKey);
      resolve(keep);
    };

    const onYes = () => finish(true);
    const onNo = () => finish(false);
    const onKey = (event) => {
      if (event.key === "Escape") finish(false);
    };

    elements.keepTakeYes.addEventListener("click", onYes);
    elements.keepTakeNo.addEventListener("click", onNo);
    document.addEventListener("keydown", onKey);
    elements.keepTakeYes.focus();
  });
}

function startRecordingUiLoop(app) {
  if (app.uiTimer) return;
  app.uiTimer = setInterval(() => tickRecordingUi(app), 250);
}

function stopRecordingUiLoop(app) {
  clearInterval(app.uiTimer);
  app.uiTimer = null;
}

function tickRecordingUi(app) {
  if (!app.isRecording) return;

  const currentTime = app.player.getCurrentTime();
  const playerState = app.player.getState();

  if (app.lastVideoTime != null && playerState !== STATE.BUFFERING) {
    const jump = Math.abs(currentTime - app.lastVideoTime);
    const threshold = (app.isRecordingPaused || playerState === STATE.PAUSED) ? 0.15 : SEEK_DETECT_SEC;
    if (jump > threshold) {
      finalizeRecording(app, { pausePlayer: false });
      return;
    }
  }
  app.lastVideoTime = currentTime;

  if (!app.isRecordingPaused && app.elements.recTimer) {
    app.elements.recTimer.textContent = formatTime(recordingElapsedSec(app));
  }
}
