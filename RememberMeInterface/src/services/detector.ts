// MediaPipe BlazeFace detector wrapper.
//
// Spec: PIPELINE.md §1.2 (step 12) — BlazeFace short-range, per-frame, on the
// client. InsightFace + embedding stay SERVER-SIDE (DESIGN_DOC.md §8.1 /
// CLAUDE.md §4). All this module does is report bboxes + confidences.
//
// MediaPipe loads its WASM runtime from jsDelivr and its model from Google
// Storage. Both URLs are locked by the plan (Task V2 Step 4) so the build is
// reproducible without bundling the ~3 MB WASM / ~1 MB model into our dist.

import { FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision";

/** Public, trimmed detection shape. Mirrors what the tracker/UI need. */
export interface FaceDetection {
  bbox: { x: number; y: number; w: number; h: number };
  score: number;
}

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

/** Only process detections at/above this confidence (PIPELINE.md §1.2 step 13). */
const MIN_DETECTION_CONFIDENCE = 0.7;

let detector: FaceDetector | null = null;
let initPromise: Promise<FaceDetector> | null = null;

/**
 * Idempotently initialise the BlazeFace detector. Safe to call repeatedly —
 * returns the same underlying detector. The WASM + model load only happens
 * on the first call.
 */
export async function init(): Promise<void> {
  if (detector !== null) return;
  if (initPromise === null) {
    initPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      return await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        minDetectionConfidence: MIN_DETECTION_CONFIDENCE,
      });
    })();
  }
  detector = await initPromise;
}

/**
 * Detect faces in a single video frame.
 *
 * @param videoEl  a playing `<video>` element; BlazeFace reads its current
 *                 frame directly.
 * @param timestampMs  monotonic timestamp in milliseconds (passed verbatim to
 *                 MediaPipe — it rejects out-of-order timestamps).
 * @returns an array of detections above `MIN_DETECTION_CONFIDENCE`. Empty if
 *          the detector is not yet initialised, so callers can poll safely
 *          during boot.
 */
export function detect(
  videoEl: HTMLVideoElement,
  timestampMs: number,
): FaceDetection[] {
  if (detector === null) return [];
  // detectForVideo is sync; it returns the latest result for this timestamp.
  const result = detector.detectForVideo(videoEl, timestampMs);
  const out: FaceDetection[] = [];
  for (const d of result.detections) {
    const mapped = mapDetection(d);
    if (mapped !== null && mapped.score >= MIN_DETECTION_CONFIDENCE) {
      out.push(mapped);
    }
  }
  return out;
}

function mapDetection(d: Detection): FaceDetection | null {
  if (d.boundingBox === undefined) return null;
  // Category 0 carries the face score. Empty categories shouldn't happen for
  // BlazeFace but guard anyway.
  const score = d.categories.length > 0 ? d.categories[0].score : 0;
  return {
    bbox: {
      x: d.boundingBox.originX,
      y: d.boundingBox.originY,
      w: d.boundingBox.width,
      h: d.boundingBox.height,
    },
    score,
  };
}

/** Destroy the detector. Used only in tests / HMR; normal pages exit. */
export async function close(): Promise<void> {
  if (detector !== null) {
    await detector.close();
    detector = null;
  }
  initPromise = null;
}
