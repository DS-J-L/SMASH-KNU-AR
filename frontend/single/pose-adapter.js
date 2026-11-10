// K-SC-03: MediaPipe wrists and ankles on frames the PC received (docs/SINGLE_CAMERA_INTERFACES.md §4–5,
// ankles for kicks: docs/FOOT_STRIKE.md).
// The runtime and model are the pinned files /camera/ already serves, so phone and PC run the same build.
export const POSE_MODULE_URL = '/camera/pose.js';
export const MIN_VISIBILITY = 0.5;
const LOAD_RETRY_MS = 5000;
// MediaPipe 15/16 and 27/28 are the subject's own left/right on the un-mirrored frame.
const WRISTS = { left_wrist: 15, right_wrist: 16 };
const ANKLES = { left_ankle: 27, right_ankle: 28 };

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

// One wrist (or ankle) of a PoseFrame. Anything that is not a usable observation is valid=false with image_norm=null.
export function toWrist(landmark, minVisibility = MIN_VISIBILITY) {
  if (!landmark) return { valid: false, image_norm: null, visibility: null, reason: 'not_detected' };
  const visibility = Number.isFinite(landmark.visibility) ? round(Math.min(Math.max(landmark.visibility, 0), 1), 3) : null;
  const { x, y } = landmark;
  let reason = null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) reason = 'non_finite';
  else if (x < 0 || x > 1 || y < 0 || y > 1) reason = 'out_of_frame';
  else if (visibility === null || visibility < minVisibility) reason = 'low_visibility';
  if (reason) return { valid: false, image_norm: null, visibility, reason };
  return { valid: true, image_norm: [round(x, 6), round(y, 6)], visibility, reason: null };
}

// The coordinator matches the result to its frame by the meta fields, so they are passed through untouched.
export function toPoseFrame(meta, result, inference) {
  const landmarks = result?.landmarks?.[0];
  const pick = (joints) => Object.fromEntries(Object.entries(joints).map(([joint, index]) => [joint, toWrist(landmarks?.[index])]));
  return { ...meta, wrists: pick(WRISTS), ankles: pick(ANKLES), inference };
}

export function createPoseAdapter({
  model = 'lite',
  loadPose = () => import(/* @vite-ignore */ POSE_MODULE_URL),
  now = () => performance.now(),
} = {}) {
  let landmarker = null;
  let delegate = null;
  let runtime = null;
  let loading = null;
  let disposed = false;
  let delegates = ['GPU', 'CPU'];
  let lastTimestamp = -Infinity;
  let warmed = false;
  // A missing runtime/model fails the same way on every frame; retry at most this often and keep the reason.
  let loadError = null;
  let loadErrorAt = -Infinity;
  const stats = { frames: 0, failures: 0, lastInferMs: null, maxInferMs: 0, totalInferMs: 0, warmupMs: null };

  // detectForVideo needs strictly increasing timestamps across every stream this instance sees.
  function nextTimestamp(ms) {
    lastTimestamp = Math.max(lastTimestamp + 1, Math.round(ms));
    return lastTimestamp;
  }

  function ready() {
    if (landmarker) return Promise.resolve(landmarker);
    if (loadError && now() - loadErrorAt < LOAD_RETRY_MS) return Promise.reject(loadError);
    loading ??= (async () => {
      const pose = await loadPose();
      const created = await pose.createPoseLandmarker(model, delegates);
      if (disposed) {
        created.landmarker.close();
        throw new Error('pose_adapter_disposed');
      }
      ({ landmarker, delegate } = created);
      runtime = pose.RUNTIME ?? null;
      loadError = null;
      return landmarker;
    })().catch((error) => {
      if (error?.message !== 'pose_adapter_disposed') {
        loadError = error;
        loadErrorAt = now();
      }
      throw error;
    }).finally(() => { loading = null; });
    return loading;
  }

  // A failed instance is not reused. If GPU inference broke, the next frame loads a CPU instance.
  function discard() {
    landmarker?.close();
    landmarker = null;
    warmed = false;
    if (delegate === 'GPU') delegates = ['CPU'];
    stats.failures += 1;
  }

  // One blank inference. On GPU the first detectForVideo compiles shaders and blocks the page, beyond any
  // frame TTL: 0.4–0.9 s on an M4 GPU in Chrome (8.9 s on one first run), 9 s under software WebGL.
  function warm(instance, width, height) {
    if (warmed || typeof document === 'undefined') return;
    const blank = document.createElement('canvas');
    blank.width = width;
    blank.height = height;
    const started = now();
    try {
      instance.detectForVideo(blank, nextTimestamp(started))?.close?.();
    } catch (error) {
      discard();
      throw error;
    }
    warmed = true;
    stats.warmupMs = now() - started;
  }

  return {
    // Load and warm the model before frames arrive. Optional: process() warms on its first frame anyway.
    async warmup({ width = 640, height = 480 } = {}) {
      const instance = await ready();
      if (!disposed) warm(instance, width, height);
    },

    // image is borrowed from the FrameCoordinator: read it, never close or transfer it.
    async process(image, meta) {
      if (disposed) throw new Error('pose_adapter_disposed');
      if (image?.width !== meta.image_width || image?.height !== meta.image_height) throw new Error('frame_size_mismatch');
      const instance = await ready();
      if (disposed) throw new Error('pose_adapter_disposed');
      // Warm with this frame's size; the coordinator drops the frames that arrive meanwhile.
      warm(instance, meta.image_width, meta.image_height);
      const timestamp = nextTimestamp(meta.observed_at_pc_ms);
      const started = now();
      let result;
      try {
        result = instance.detectForVideo(image, timestamp);
      } catch (error) {
        discard();
        throw error;
      }
      const ended = now();
      try {
        stats.frames += 1;
        stats.lastInferMs = ended - started;
        stats.maxInferMs = Math.max(stats.maxInferMs, stats.lastInferMs);
        stats.totalInferMs += stats.lastInferMs;
        return toPoseFrame(meta, result, {
          started_at_pc_ms: round(started, 2),
          ended_at_pc_ms: round(ended, 2),
          model: `pose_landmarker_${model}`,
          delegate,
          runtime,
        });
      } finally {
        result?.close?.();
      }
    },

    info: () => ({ model: `pose_landmarker_${model}`, delegate, runtime, ready: Boolean(landmarker), loadError: loadError?.message ?? null, stats: { ...stats } }),

    dispose() {
      disposed = true;
      landmarker?.close();
      landmarker = null;
    },
  };
}

// Plugs the adapter into window.singleCameraMonitor (docs/SINGLE_CAMERA_MONITOR.md).
// eagerWarmup=false defers loading MediaPipe to the first live frame, so pages that never receive video
// (synthetic mode, before the phone connects) are not blocked by the model warm-up.
export function attachPoseAdapter(monitor, { eagerWarmup = true, ...options } = {}) {
  const adapter = createPoseAdapter(options);
  const detach = monitor.attachPoseProcessor((image, meta) => adapter.process(image, meta));
  // Frames that arrive while this runs are dropped by the coordinator; a failure shows up on them too.
  const ready = eagerWarmup ? adapter.warmup() : Promise.resolve();
  ready.catch(() => {});
  return {
    adapter,
    ready,
    dispose() {
      detach();
      adapter.dispose();
    },
  };
}
