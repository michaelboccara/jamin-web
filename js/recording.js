// Recording session wiring — player state and record button.

export function initRecording({ elements, player, recordingSession }) {
  elements.recBtn.addEventListener("click", async () => {
    if (recordingSession.isKeepTakePending()) return;
    if (recordingSession.isRecording()) {
      await recordingSession.finalize({ pausePlayer: true });
    } else {
      await recordingSession.start();
    }
  });

  player.onStateChange((state) => recordingSession.onPlayerStateChange(state));
}
