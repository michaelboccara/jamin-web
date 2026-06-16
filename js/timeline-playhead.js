// Playhead cursor + timeline transport: seek drag, click to play/pause.

import { STATE } from "./youtube.js";

export function initPlayhead(app) {
  const { elements, player } = app;
  let rafId = null;
  let animating = false;
  let dragging = false;
  let playheadDragged = false;

  function timeFromClientX(clientX) {
    const panel = elements.timelinePanel;
    if (!panel) return 0;
    const rect = panel.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, ratio));
  }

  function seekToRatio(ratio) {
    const duration = player.getDuration();
    if (duration <= 0) return;
    const time = ratio * duration;
    player.seekTo(time);
    if (elements.playhead) {
      elements.playhead.style.left = `${ratio * 100}%`;
      elements.playhead.hidden = elements.timelinePanel.hidden;
    }
  }

  function updatePlayhead() {
    if (dragging) return;
    const duration = player.getDuration();
    if (!elements.playhead || !elements.timelinePanel || duration <= 0) {
      if (elements.playhead) elements.playhead.hidden = true;
      return;
    }
    const t = Math.max(0, Math.min(duration, player.getCurrentTime()));
    elements.playhead.style.left = `${(t / duration) * 100}%`;
    elements.playhead.hidden = elements.timelinePanel.hidden;
  }

  function tick() {
    updatePlayhead();
    if (animating) rafId = requestAnimationFrame(tick);
  }

  function setAnimating(on) {
    animating = on;
    cancelAnimationFrame(rafId);
    if (animating) rafId = requestAnimationFrame(tick);
    else updatePlayhead();
  }

  function togglePlayPause() {
    const state = player.getState();
    if (state === STATE.PLAYING) player.pause();
    else player.play();
  }

  player.onStateChange((state) => {
    if (state === STATE.PLAYING) setAnimating(true);
    else if (
      state === STATE.PAUSED ||
      state === STATE.ENDED ||
      state === STATE.CUED ||
      state === STATE.UNSTARTED
    ) {
      setAnimating(false);
    } else if (state === STATE.BUFFERING) {
      setAnimating(false);
    }
  });

  elements.playhead?.addEventListener("pointerdown", (event) => {
    if (elements.timelinePanel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    playheadDragged = false;
    elements.playhead.classList.add("is-dragging");
    elements.playhead.setPointerCapture(event.pointerId);
    seekToRatio(timeFromClientX(event.clientX));
  });

  elements.playhead?.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    playheadDragged = true;
    seekToRatio(timeFromClientX(event.clientX));
  });

  const endPlayheadDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    elements.playhead.classList.remove("is-dragging");
    if (event?.pointerId != null) {
      try {
        elements.playhead.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
    updatePlayhead();
    if (playheadDragged) {
      setTimeout(() => {
        playheadDragged = false;
      }, 0);
    }
  };

  elements.playhead?.addEventListener("pointerup", endPlayheadDrag);
  elements.playhead?.addEventListener("pointercancel", endPlayheadDrag);

  elements.timelinePanel?.addEventListener("click", (event) => {
    if (elements.timelinePanel.hidden) return;
    if (playheadDragged || dragging) return;
    if (event.target.closest(".timeline-controls")) return;
    if (event.target.closest(".timeline-playhead")) return;
    if (event.target.closest(".rec-offset-row")) return;
    togglePlayPause();
  });

  app.refreshPlayhead = updatePlayhead;
  updatePlayhead();
}
