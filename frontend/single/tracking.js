// Registers the K-SC-03/04/05 modules on the single-camera monitor (docs/SINGLE_CAMERA_MONITOR.md).
// index.html has to load this after main.js, which defines window.singleCameraMonitor:
//   <script type="module" src="./main.js"></script><script type="module" src="./tracking.js"></script>
import { attachPoseAdapter } from './pose-adapter.js';
import { attachHitDetector } from './hit-detector.js';
import { createHitSound } from './hit-sound.js';

// Any click or key press on the page counts as the gesture that lets audio start; the start button
// is pressed before any hit can be accepted.
const GESTURES = ['pointerdown', 'keydown'];

export function attachTracking(monitor, { target = globalThis.document, pose: poseOptions, sound = createHitSound() } = {}) {
  // MediaPipe loads on the first live frame: synthetic mode and the page before a phone connects never pay
  // for the warm-up, which blocked the page for 9 s under software WebGL.
  const pose = attachPoseAdapter(monitor, { eagerWarmup: false, ...poseOptions });
  const hit = attachHitDetector(monitor, {
    // Only hits the game accepted make a sound; rejected or duplicate events stay silent.
    onResult: (event, result) => { if (result.accepted) sound.play(event); },
  });
  // Build the audio context now, while nothing is timing-sensitive; the gesture only resumes it.
  sound.prepare();
  const unlock = () => {
    void sound.unlock().then((running) => {
      if (running) for (const type of GESTURES) target?.removeEventListener(type, unlock, true);
    });
  };
  for (const type of GESTURES) target?.addEventListener(type, unlock, true);
  return {
    pose,
    hit,
    sound,
    dispose() {
      for (const type of GESTURES) target?.removeEventListener(type, unlock, true);
      hit.dispose();
      pose.dispose();
      sound.dispose();
    },
  };
}

if (globalThis.window?.singleCameraMonitor) {
  const tracking = attachTracking(window.singleCameraMonitor);
  window.singleCameraTracking = tracking;
  // The monitor releases its own resources on pagehide and reloads if restored from the page cache.
  window.addEventListener('pagehide', () => tracking.dispose(), { once: true });
}
