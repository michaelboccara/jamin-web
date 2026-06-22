// Recording session state machine — mic capture tied to video playback.

import { SEEK_DETECT_SEC } from "../constants.js";
import { reportError } from "../errors.js";
import { formatTime } from "../ui.js";
import { computePeaks } from "../waveform.js";
import { enableRecordButton } from "../video.js";
import { getEffectiveRawMic } from "../audio-devices.js";
import { STATE } from "../youtube.js";

export function createRecordingSession({
  player,
  recorder,
  engine,
  trackStore,
  videoStore,
  settings,
  elements,
  bus,
  notify,
}) {
  let isRecording = false;
  let isRecordingPaused = false;
  let keepTakePending = false;
  let finalizingRecording = false;
  let recStartVideoTime = 0;
  let recActiveMs = 0;
  let recSegmentStartedAt = 0;
  let lastVideoTime = null;
  let uiTimer = null;

  function emitState() {
    bus.emit("recording:state-changed", { isRecording, isRecordingPaused });
  }

  function markSegmentEnd() {
    if (recSegmentStartedAt) {
      recActiveMs += Date.now() - recSegmentStartedAt;
      recSegmentStartedAt = 0;
    }
  }

  function elapsedSec() {
    let milliseconds = recActiveMs;
    if (recSegmentStartedAt) milliseconds += Date.now() - recSegmentStartedAt;
    return milliseconds / 1000;
  }

  function syncMonitorDuringRecording() {
    engine.start();
  }

  function stopUiLoop() {
    clearInterval(uiTimer);
    uiTimer = null;
  }

  function startUiLoop() {
    if (uiTimer) return;
    uiTimer = setInterval(() => tickUi(), 250);
  }

  function confirmKeepTake() {
    return new Promise((resolve) => {
      keepTakePending = true;
      elements.recBtn.disabled = true;
      elements.keepTakeModal.hidden = false;

      const finish = (keep) => {
        keepTakePending = false;
        elements.keepTakeModal.hidden = true;
        enableRecordButton(elements, !!videoStore.getVideoId());
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

  async function start() {
    if (keepTakePending) return;

    settings.setRawMic(getEffectiveRawMic());
    const rawMic = getEffectiveRawMic();

    engine.stop();
    if (rawMic) recorder.resetMic();

    try {
      await recorder.ensureMic();
    } catch (error) {
      notify(error.message, "error");
      return;
    }

    player.play();
    recStartVideoTime = player.getCurrentTime();
    recActiveMs = 0;
    recSegmentStartedAt = Date.now();
    lastVideoTime = recStartVideoTime;
    isRecordingPaused = false;
    await recorder.start();
    isRecording = true;

    elements.recBtn.textContent = "■ Stop take";
    elements.recBtn.classList.add("is-recording");
    elements.recIndicator.hidden = false;
    elements.recIndicator.innerHTML = `● REC <span id="recTimer">0:00</span>`;
    elements.recTimer = document.getElementById("recTimer");

    syncMonitorDuringRecording();
    emitState();
    startUiLoop();
  }

  function pause() {
    if (!isRecording || isRecordingPaused) return;
    markSegmentEnd();
    recorder.pause();
    isRecordingPaused = true;
    elements.recIndicator.textContent = "⏸ Paused";
    emitState();
  }

  function resume() {
    if (!isRecording || !isRecordingPaused) return;
    recorder.resume();
    isRecordingPaused = false;
    recSegmentStartedAt = Date.now();
    elements.recIndicator.innerHTML =
      `● REC <span id="recTimer">${formatTime(elapsedSec())}</span>`;
    elements.recTimer = document.getElementById("recTimer");
    emitState();
  }

  async function finalize({ pausePlayer = false } = {}) {
    if (!isRecording || finalizingRecording) return;
    finalizingRecording = true;
    isRecording = false;
    isRecordingPaused = false;

    elements.recBtn.textContent = "● Record";
    elements.recBtn.classList.remove("is-recording");
    elements.recIndicator.hidden = true;

    if (pausePlayer) player.pause();
    engine.stop();
    stopUiLoop();
    markSegmentEnd();
    lastVideoTime = null;
    emitState();

    let result;
    try {
      result = await recorder.stop();
    } catch (error) {
      reportError("finalizeRecording", error, null, notify);
      finalizingRecording = false;
      return;
    }

    const { blob, mimeType } = result;
    let duration = elapsedSec();
    let peaks = [];

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await audioContext.decodeAudioData((await blob.arrayBuffer()).slice(0));
      duration = buffer.duration;
      peaks = computePeaks(buffer);
      audioContext.close();
    } catch (error) {
      reportError("finalizeRecording.decode", error, null, notify);
    }

    const keep = await confirmKeepTake();
    finalizingRecording = false;
    if (!keep) {
      notify("Take discarded.");
      return;
    }

    const videoId = videoStore.getVideoId();
    const trackData = {
      videoId,
      name: `Take ${trackStore.getTracks().length + 1}`,
      startTime: recStartVideoTime,
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
      await trackStore.add(trackData);
      notify("Take saved.", "success");
    } catch (error) {
      reportError("finalizeRecording.save", error, "Could not save this take.", notify);
    }
  }

  function tickUi() {
    if (!isRecording) return;

    const currentTime = player.getCurrentTime();
    const playerState = player.getState();

    if (lastVideoTime != null && playerState !== STATE.BUFFERING) {
      const jump = Math.abs(currentTime - lastVideoTime);
      const threshold = (isRecordingPaused || playerState === STATE.PAUSED) ? 0.15 : SEEK_DETECT_SEC;
      if (jump > threshold) {
        finalize({ pausePlayer: false });
        return;
      }
    }
    lastVideoTime = currentTime;

    if (!isRecordingPaused && elements.recTimer) {
      elements.recTimer.textContent = formatTime(elapsedSec());
    }
  }

  function onPlayerStateChange(state) {
    if (state === STATE.PLAYING) {
      if (isRecording && isRecordingPaused) resume();
      syncMonitorDuringRecording();
      if (isRecording) startUiLoop();
    } else if (state === STATE.PAUSED) {
      engine.stop();
      if (isRecording && !isRecordingPaused) pause();
      if (isRecording) startUiLoop();
      else stopUiLoop();
    } else if (state === STATE.ENDED) {
      engine.stop();
      if (isRecording) finalize({ pausePlayer: false });
      stopUiLoop();
    } else if (state === STATE.BUFFERING) {
      engine.stop();
    }
  }

  return {
    isKeepTakePending() {
      return keepTakePending;
    },
    isRecording() {
      return isRecording;
    },
    start,
    finalize,
    onPlayerStateChange,
    startUiLoop,
    stopUiLoop,
  };
}
