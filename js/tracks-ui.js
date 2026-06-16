// Track list UI: render, preview, mute, sync nudge, delete.

import * as db from "./db.js";
import { reportError } from "./errors.js";
import { drawWaveform } from "./waveform.js";
import { formatTime, getAccentColor, makeIconButton } from "./ui.js";

export function createTrackListController(app) {
  let previewAudio = null;

  function renderTracks() {
    const { elements, tracks } = app;
    elements.trackList.innerHTML = "";
    elements.emptyHint.hidden = tracks.length > 0;

    for (const track of tracks) {
      elements.trackList.append(buildTrackElement(app, track, () => previewAudio, (audio) => {
        previewAudio = audio;
      }));
    }
  }

  function redrawWaveforms() {
    app.elements.trackList.querySelectorAll("canvas.waveform").forEach((canvas) => {
      drawWaveform(canvas, canvas._peaks, getAccentColor());
    });
  }

  return { renderTracks, redrawWaveforms };
}

function buildTrackElement(app, track, getPreviewAudio, setPreviewAudio) {
  const listItem = document.createElement("li");
  listItem.className = "track";

  const row = document.createElement("div");
  row.className = "track-row";

  const nameInput = document.createElement("input");
  nameInput.className = "track-name";
  nameInput.value = track.name;
  nameInput.title = "Rename take";
  nameInput.addEventListener("change", async () => {
    track.name = nameInput.value.trim() || track.name;
    nameInput.value = track.name;
    try {
      await db.updateTrack(track);
    } catch (error) {
      reportError("updateTrack", error, "Could not rename this take.", app.notify);
    }
  });

  const timeLabel = document.createElement("span");
  timeLabel.className = "track-time";
  timeLabel.textContent =
    `${formatTime(track.startTime)} · ${track.duration ? track.duration.toFixed(1) : "?"}s`;

  row.append(nameInput, timeLabel);

  const canvas = document.createElement("canvas");
  canvas.className = "waveform";
  canvas._peaks = track.peaks;

  const controls = document.createElement("div");
  controls.className = "track-controls";

  const previewButton = makeIconButton("▶", "Preview this take", () => {
    previewTrack(track, previewButton, getPreviewAudio, setPreviewAudio);
  });
  const muteButton = makeIconButton(
    track.muted ? "🔇" : "🔊",
    "Mute in mix",
    () => toggleMute(app, track, muteButton)
  );
  if (track.muted) muteButton.classList.add("active");

  const volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.className = "vol";
  volumeSlider.min = "0";
  volumeSlider.max = "1";
  volumeSlider.step = "0.01";
  volumeSlider.value = String(track.volume ?? 1);
  volumeSlider.title = "Volume in mix";
  volumeSlider.addEventListener("input", () => {
    track.volume = parseFloat(volumeSlider.value);
    app.engine.setVolume(track.id, track.volume);
  });
  volumeSlider.addEventListener("change", async () => {
    try {
      await db.updateTrack(track);
    } catch (error) {
      reportError("updateTrack", error, null, app.notify);
    }
  });

  const deleteButton = makeIconButton("🗑", "Delete take", () => deleteTrack(app, track));
  deleteButton.classList.add("danger");

  controls.append(previewButton, muteButton, volumeSlider, deleteButton);

  const syncRow = document.createElement("div");
  syncRow.className = "track-sync";
  const syncLabel = document.createElement("span");
  syncLabel.className = "track-sync-label";
  syncLabel.title = "Nudge this take's sync (+ = earlier, − = later)";

  const renderSyncLabel = () => {
    const milliseconds = Math.round((track.offset || 0) * 1000);
    syncLabel.textContent = `sync ${milliseconds >= 0 ? "+" : ""}${milliseconds} ms`;
  };

  const minusButton = makeIconButton("−", "Nudge 10 ms later", () => {
    nudgeTrack(app, track, -0.01, renderSyncLabel);
  });
  const plusButton = makeIconButton("+", "Nudge 10 ms earlier", () => {
    nudgeTrack(app, track, 0.01, renderSyncLabel);
  });
  renderSyncLabel();
  syncRow.append(minusButton, syncLabel, plusButton);

  listItem.append(row, canvas, controls, syncRow);
  requestAnimationFrame(() => drawWaveform(canvas, track.peaks, getAccentColor()));
  return listItem;
}

function previewTrack(track, button, getPreviewAudio, setPreviewAudio) {
  const current = getPreviewAudio();
  if (current) {
    current.pause();
    setPreviewAudio(null);
  }
  const url = URL.createObjectURL(track.blob);
  const audio = new Audio(url);
  setPreviewAudio(audio);
  audio.play();
  button.classList.add("active");
  audio.onended = () => {
    button.classList.remove("active");
    URL.revokeObjectURL(url);
    setPreviewAudio(null);
  };
}

function nudgeTrack(app, track, deltaSeconds, renderSyncLabel) {
  track.offset = Math.round(((track.offset || 0) + deltaSeconds) * 1000) / 1000;
  app.engine.setTrackOffset(track.id, track.offset);
  if (renderSyncLabel) renderSyncLabel();
  db.updateTrack(track).catch((error) => {
    reportError("nudgeTrack", error, null, app.notify);
  });
}

function toggleMute(app, track, button) {
  track.muted = !track.muted;
  button.textContent = track.muted ? "🔇" : "🔊";
  button.classList.toggle("active", track.muted);
  app.engine.setMuted(track.id, track.muted);
  db.updateTrack(track).catch((error) => {
    reportError("toggleMute", error, null, app.notify);
  });
}

async function deleteTrack(app, track) {
  if (!confirm(`Delete "${track.name}"?`)) return;
  try {
    await db.deleteTrack(track.id);
    app.engine.removeTrack(track.id);
    app.tracks = app.tracks.filter((entry) => entry.id !== track.id);
    app.renderTracks();
    app.renderHistory();
    app.notify("Take deleted.");
  } catch (error) {
    reportError("deleteTrack", error, "Could not delete this take.", app.notify);
  }
}
