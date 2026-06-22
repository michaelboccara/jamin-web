// ============================================================
// main.js — bootstrap: wire UI, video, recording, sync, storage.
// ============================================================

import { DEFAULT_LATENCY_OFFSET_SEC } from "./constants.js";
import { Player } from "./youtube.js";
import { Recorder, recordingSupportError } from "./recorder.js";
import { PlaybackEngine } from "./playback.js";
import { bindElements, initTheme, showToast } from "./ui.js";
import { initTimelineSync, loadInitialVideo, enableRecordButton } from "./video.js";
import { initLatencyOffset } from "./latency.js";
import { initSearch } from "./search-ui.js";
import { initRecording } from "./recording.js";
import { createTrackListController } from "./tracks-ui.js";
import { renderHistory } from "./history-ui.js";
import { initExportImport } from "./export-import.js";
import { initPwa } from "./pwa.js";
import { initPlayhead } from "./timeline-playhead.js";
import { initAdvanced } from "./advanced-ui.js";
import { initAudioDevices } from "./audio-devices.js";

// Touch-primary devices get Share instead of Export/Import.
const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
document.documentElement.dataset.platform = coarsePointer ? "mobile" : "desktop";

const elements = bindElements();
const player = new Player("player");
const recorder = new Recorder();
const engine = new PlaybackEngine(() => player.getCurrentTime());

const app = {
  elements,
  player,
  recorder,
  engine,
  recordingSupportError,
  notify: (message, kind) => showToast(elements, message, kind),
  enableRecordButton: (enabled) => enableRecordButton(app, enabled),

  // Lightweight in-memory state (no framework).
  currentVideoId: null,
  tracks: [],
  isRecording: false,
  isRecordingPaused: false,
  keepTakePending: false,
  finalizingRecording: false,
  recStartVideoTime: 0,
  recActiveMs: 0,
  recSegmentStartedAt: 0,
  lastVideoTime: null,
  uiTimer: null,
  latencyOffset: DEFAULT_LATENCY_OFFSET_SEC,
  soloTrackId: null,
  searchSequence: 0,
  deferredInstallPrompt: null,
  rawMicEnabled: false,
};

const trackList = createTrackListController(app);
app.renderTracks = trackList.renderTracks;
app.redrawWaveforms = trackList.redrawWaveforms;
app.layoutTrackRows = trackList.layoutAllTrackRows;
app.renderHistory = () => renderHistory(app);

initTheme();
initTimelineSync(app);
initLatencyOffset(app);
initAdvanced(app);
initAudioDevices(app);
initSearch(app);
initRecording(app);
initExportImport(app);
initPlayhead(app);
initPwa(app);

const recordingError = recordingSupportError();
if (recordingError) app.notify(recordingError, "error");

loadInitialVideo(app);
renderHistory(app);

window.addEventListener("resize", () => {
  trackList.redrawWaveforms();
  trackList.layoutAllTrackRows();
});
window.addEventListener("jamin:theme-changed", () => trackList.redrawWaveforms());
