// Timeline track UI: positioned waveforms, segment bounds, hover controls.

import * as db from "./db.js";
import { reportError } from "./errors.js";
import { drawTimelineWaveform } from "./waveform.js";
import { confirmDeleteTake, formatTime, getAccentColor, makeIconButton } from "./ui.js";

const LONG_PRESS_MS = 450;
const NUDGE_SEC = 0.01;
const CONTROLS_GAP_PX = 4;

let activeTrackRow = null;
let volOpenRow = null;

export function createTrackListController(app) {
  function getTimelineMetrics() {
    return {
      videoDuration: app.player.getDuration() || 0,
      globalOffset: app.latencyOffset || 0,
    };
  }

  function getTrackSegment(track, metrics) {
    const { videoDuration, globalOffset } = metrics;
    if (videoDuration <= 0) {
      return { segmentLeft: 0, segmentWidth: 0 };
    }
    const effStart = track.startTime - globalOffset - (track.offset || 0);
    return {
      segmentLeft: effStart / videoDuration,
      segmentWidth: (track.duration || 0) / videoDuration,
    };
  }

  function updateRuler() {
    const { elements } = app;
    const duration = app.player.getDuration() || 0;
    if (elements.timelineRulerStart) {
      elements.timelineRulerStart.textContent = formatTime(0);
    }
    if (elements.timelineRulerEnd) {
      elements.timelineRulerEnd.textContent = formatTime(duration);
    }
  }

  function layoutTrackRow(row) {
    if (!row._segmentEl || !row._controlsEl || !row._getSegment) return;
    const segment = row._getSegment();
    const { segmentLeft, segmentWidth } = segment;
    const rowW = row.clientWidth;
    if (rowW <= 0) return;

    row._segmentEl.style.left = `${segmentLeft * 100}%`;
    row._segmentEl.style.width = `${Math.max(0, segmentWidth) * 100}%`;

    const controlsW = row._controlsEl.offsetWidth || 210;
    const segEnd = segmentLeft + segmentWidth;
    const spaceRight = (1 - segEnd) * rowW;
    const spaceLeft = segmentLeft * rowW;
    const need = controlsW + CONTROLS_GAP_PX;

    row._controlsEl.classList.remove("align-left", "align-right", "align-inside");
    if (spaceRight >= need || spaceRight >= spaceLeft) {
      row._controlsEl.classList.add("align-right");
      row._controlsEl.style.left = `${segEnd * 100}%`;
    } else if (spaceLeft >= need) {
      row._controlsEl.classList.add("align-left");
      row._controlsEl.style.left = `${segmentLeft * 100}%`;
    } else {
      row._controlsEl.classList.add("align-inside");
      const insideLeft = Math.max(0, Math.min(1 - controlsW / rowW, segEnd - controlsW / rowW));
      row._controlsEl.style.left = `${insideLeft * 100}%`;
    }
  }

  function layoutAllTrackRows() {
    app.elements.trackList.querySelectorAll(".timeline-track").forEach(layoutTrackRow);
  }

  function renderTracks() {
    const { elements, tracks } = app;
    elements.trackList.innerHTML = "";
    const hasTracks = tracks.length > 0;
    elements.emptyHint.hidden = hasTracks;
    elements.timelinePanel.hidden = !app.currentVideoId;

    updateRuler();

    const sorted = [...tracks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    for (const track of sorted) {
      elements.trackList.append(buildTrackElement(app, track, getTimelineMetrics, getTrackSegment, layoutTrackRow));
    }

    requestAnimationFrame(() => {
      layoutAllTrackRows();
      app.refreshPlayhead?.();
    });
  }

  function redrawWaveforms() {
    const metrics = getTimelineMetrics();
    const color = getAccentColor();
    app.elements.trackList.querySelectorAll("canvas.timeline-wave").forEach((canvas) => {
      const track = app.tracks.find((t) => t.id === canvas.dataset.trackId);
      if (!track) return;
      const segment = getTrackSegment(track, metrics);
      canvas._segment = segment;
      drawTimelineWaveform(canvas, canvas._peaks, { ...segment, color });
    });
    updateRuler();
    layoutAllTrackRows();
    app.refreshPlayhead?.();
  }

  return { renderTracks, redrawWaveforms, layoutAllTrackRows };
}

function buildTrackElement(app, track, getTimelineMetrics, getTrackSegment, layoutTrackRow) {
  const row = document.createElement("div");
  row.className = "timeline-track";
  row.dataset.trackId = track.id;

  const canvas = document.createElement("canvas");
  canvas.className = "timeline-wave";
  canvas.dataset.trackId = track.id;
  canvas._peaks = track.peaks;

  const segmentEl = document.createElement("div");
  segmentEl.className = "timeline-segment";
  segmentEl.setAttribute("aria-hidden", "true");

  const controls = document.createElement("div");
  controls.className = "timeline-controls";

  const sync = document.createElement("div");
  sync.className = "timeline-sync";

  const syncMs = document.createElement("span");
  syncMs.className = "track-sync-ms";
  syncMs.title = "Double-click to reset nudge to 0 ms";

  const renderSyncMs = () => {
    const ms = Math.round((track.offset || 0) * 1000);
    syncMs.textContent = `${ms >= 0 ? "+" : ""}${ms} ms`;
  };

  const refreshSegment = () => {
    const metrics = getTimelineMetrics();
    const segment = getTrackSegment(track, metrics);
    canvas._segment = segment;
    drawTimelineWaveform(canvas, canvas._peaks, { ...segment, color: getAccentColor() });
    layoutTrackRow(row);
  };

  const earlierBtn = makeIconButton("◀", "Nudge 10 ms earlier", () => {
    nudgeTrack(app, track, -NUDGE_SEC, renderSyncMs, refreshSegment);
  });
  const laterBtn = makeIconButton("▶", "Nudge 10 ms later", () => {
    nudgeTrack(app, track, NUDGE_SEC, renderSyncMs, refreshSegment);
  });
  renderSyncMs();
  sync.append(earlierBtn, syncMs, laterBtn);

  syncMs.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetTrackOffset(app, track, renderSyncMs, refreshSegment);
  });

  const volWrap = document.createElement("div");
  volWrap.className = "timeline-vol";

  const volBtn = makeIconButton(
    track.muted ? "🔇" : "🔊",
    "Click to mute; hold for volume",
    () => {}
  );
  if (track.muted) volBtn.classList.add("muted");

  const volPopover = document.createElement("div");
  volPopover.className = "vol-popover";
  const volSlider = document.createElement("input");
  volSlider.type = "range";
  volSlider.min = "0";
  volSlider.max = "1";
  volSlider.step = "0.01";
  volSlider.value = String(track.volume ?? 1);
  volSlider.title = "Volume in mix";
  volSlider.setAttribute("aria-label", "Track volume");
  volSlider.addEventListener("input", () => {
    track.volume = parseFloat(volSlider.value);
    if (!track.muted) app.engine.setVolume(track.id, track.volume);
  });
  volSlider.addEventListener("change", () => {
    db.updateTrack(track).catch((error) => {
      reportError("updateTrack", error, null, app.notify);
    });
  });
  volPopover.append(volSlider);
  volWrap.append(volBtn, volPopover);
  wireVolumeButton(app, track, row, volBtn);

  const soloWrap = document.createElement("div");
  soloWrap.className = "timeline-solo";
  const soloBtn = makeIconButton("S", "Solo — hear only this take", () => {
    toggleSolo(app, track);
  });
  if (app.soloTrackId === track.id) soloBtn.classList.add("active");
  soloWrap.append(soloBtn);

  const delWrap = document.createElement("div");
  delWrap.className = "timeline-del";
  const deleteBtn = makeIconButton("🗑", "Delete take", () => {
    deleteTrack(app, track);
  });
  deleteBtn.classList.add("danger");
  delWrap.append(deleteBtn);

  controls.append(sync, volWrap, soloWrap, delWrap);
  controls.addEventListener("click", (event) => event.stopPropagation());

  row._segmentEl = segmentEl;
  row._controlsEl = controls;
  row._getSegment = () => getTrackSegment(track, getTimelineMetrics());

  row.append(canvas, segmentEl, controls);
  wireRowActivation(row, controls, () => layoutTrackRow(row));

  requestAnimationFrame(refreshSegment);

  return row;
}

function wireRowActivation(row, controls, onActivate) {
  row.addEventListener("pointerdown", (event) => {
    if (controls.contains(event.target)) return;
    setActiveTrackRow(row);
    onActivate?.();
  });

  controls.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    setActiveTrackRow(row);
    onActivate?.();
  });

  row.addEventListener("mouseenter", () => onActivate?.());
}

function setActiveTrackRow(row) {
  if (activeTrackRow && activeTrackRow !== row) {
    activeTrackRow.classList.remove("is-active");
  }
  activeTrackRow = row;
  row.classList.add("is-active");
}

function closeVolPopover() {
  if (volOpenRow) {
    volOpenRow.classList.remove("vol-open");
    volOpenRow = null;
  }
}

document.addEventListener("pointerdown", (event) => {
  if (activeTrackRow && !activeTrackRow.contains(event.target)) {
    activeTrackRow.classList.remove("is-active");
    activeTrackRow = null;
  }
  if (volOpenRow && !volOpenRow.contains(event.target)) {
    closeVolPopover();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeVolPopover();
});

function wireVolumeButton(app, track, row, volBtn) {
  let pressTimer = null;
  let longPressFired = false;

  const clearPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  volBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    longPressFired = false;
    clearPress();
    pressTimer = setTimeout(() => {
      longPressFired = true;
      closeVolPopover();
      row.classList.add("vol-open");
      volOpenRow = row;
    }, LONG_PRESS_MS);
  });

  volBtn.addEventListener("pointerup", () => {
    clearPress();
    if (!longPressFired) toggleMute(app, track, volBtn);
  });

  volBtn.addEventListener("pointercancel", clearPress);
}

function nudgeTrack(app, track, deltaSeconds, renderSyncMs, refreshSegment) {
  track.offset = Math.round(((track.offset || 0) + deltaSeconds) * 1000) / 1000;
  app.engine.setTrackOffset(track.id, track.offset);
  renderSyncMs();
  refreshSegment();
  db.updateTrack(track).catch((error) => {
    reportError("nudgeTrack", error, null, app.notify);
  });
}

function resetTrackOffset(app, track, renderSyncMs, refreshSegment) {
  if ((track.offset || 0) === 0) return;
  track.offset = 0;
  app.engine.setTrackOffset(track.id, 0);
  renderSyncMs();
  refreshSegment();
  db.updateTrack(track).catch((error) => {
    reportError("resetTrackOffset", error, null, app.notify);
  });
}

function toggleMute(app, track, button) {
  track.muted = !track.muted;
  button.textContent = track.muted ? "🔇" : "🔊";
  button.classList.toggle("muted", track.muted);
  app.engine.setMuted(track.id, track.muted);
  db.updateTrack(track).catch((error) => {
    reportError("toggleMute", error, null, app.notify);
  });
}

function toggleSolo(app, track) {
  app.soloTrackId = app.soloTrackId === track.id ? null : track.id;
  app.engine.setSolo(app.soloTrackId);
  app.elements.trackList.querySelectorAll(".timeline-track").forEach((row) => {
    const btn = row.querySelector(".timeline-solo .icon-btn");
    if (!btn) return;
    btn.classList.toggle("active", row.dataset.trackId === String(app.soloTrackId));
  });
}

async function deleteTrack(app, track) {
  const ok = await confirmDeleteTake(app.elements);
  if (!ok) return;
  try {
    if (app.soloTrackId === track.id) {
      app.soloTrackId = null;
      app.engine.setSolo(null);
    }
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
