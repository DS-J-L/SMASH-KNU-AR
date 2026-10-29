// MediaPipe Pose on the phone. Files come from tools/fetch_mediapipe.py, never a remote CDN.
const VENDOR = "/public/vendor/mediapipe";
export const RUNTIME = { package: "@mediapipe/tasks-vision", version: "0.10.35" };
export const MODELS = {
  lite: `${VENDOR}/models/pose_landmarker_lite.task`,
  full: `${VENDOR}/models/pose_landmarker_full.task`,
};
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

let visionModule = null;

async function loadVision() {
  if (!visionModule) {
    try {
      visionModule = await import(`${VENDOR}/vision_bundle.mjs`);
    } catch {
      throw new Error("MediaPipe 파일이 없습니다. PC에서 `python tools/fetch_mediapipe.py`를 실행하세요.");
    }
  }
  return visionModule;
}

// Returns {landmarker, delegate}. GPU first, CPU if the phone's WebGL path fails.
export async function createPoseLandmarker(model) {
  const { FilesetResolver, PoseLandmarker } = await loadVision();
  const fileset = await FilesetResolver.forVisionTasks(`${VENDOR}/wasm`);
  let lastError = null;
  for (const delegate of ["GPU", "CPU"]) {
    try {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS[model], delegate },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      return { landmarker, delegate };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Normalized landmark → raw pixel of the frame MediaPipe saw. Off-frame points are not observations.
function toPixel(landmark, width, height) {
  if (!landmark) return null;
  const u = landmark.x * width;
  const v = landmark.y * height;
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u > width || v > height) return null;
  const visibility = Number.isFinite(landmark.visibility) ? Math.min(Math.max(landmark.visibility, 0), 1) : null;
  return { u_px: round(u), v_px: round(v), visibility: visibility === null ? null : round(visibility, 3) };
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

// MediaPipe 15/16 are the subject's own left/right on the un-mirrored frame.
export function extractWrists(result, width, height) {
  const pose = result?.landmarks?.[0];
  if (!pose) return { left_wrist: null, right_wrist: null };
  return {
    left_wrist: toPixel(pose[LEFT_WRIST], width, height),
    right_wrist: toPixel(pose[RIGHT_WRIST], width, height),
  };
}
