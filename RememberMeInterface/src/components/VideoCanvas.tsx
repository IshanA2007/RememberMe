// VideoCanvas — the fullscreen camera view plus bbox overlay.
//
// This component owns:
//   - Camera acquisition via `navigator.mediaDevices.getUserMedia`
//     (1280x720, user-facing, no audio — audio is acquired separately by
//     conversation_capture.ts to avoid double prompts).
//   - Per-frame detection via `services/detector` (MediaPipe BlazeFace)
//     and IoU tracking via `services/tracker`.
//   - Drawing bbox strokes on an overlay `<canvas>`:
//        2px --accent       when the App has a current match for the frame_id
//        2px --signal-warm  when there is no match yet (unknown)
//   - An imperative handle (forwardRef) exposing:
//        pickFocusFace()              → the frame_id of the largest "stale" face
//        cropFaceBase64(id)           → a padded 160x160 JPEG base64 for WS recognize
//        cropFaceThumbnailBase64(id)  → a 96x96 JPEG base64 for pending-faces
//
// The component does NOT own the WebSocket — the parent App orchestrates
// throttling and sending per PIPELINE §1.2 step 15-20.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import * as detector from "../services/detector";
import { IoUTracker, type TrackedDetection } from "../services/tracker";
import type { BBox } from "../types/api";

/** Status of each drawn bbox. */
export type BoxStatus = "matched" | "unknown";

/** An overlay record the parent uses to position IdentityCard / UnknownBadge. */
export interface OverlayBox {
  frame_id: string;
  bbox: BBox;
  status: BoxStatus;
  /** intrinsic video size at the time of detection (for card scaling) */
  videoWidth: number;
  videoHeight: number;
  /** element bounding rect at the time of detection (viewport-space) */
  videoRect: DOMRect;
}

export interface VideoCanvasHandle {
  /**
   * Pick the "focus face" the App should send for recognition:
   * the largest face that is either unknown or whose last match is older
   * than the supplied `staleBeforeMs` timestamp.
   *
   * Returns null if no candidate exists.
   */
  pickFocusFace(staleBeforeMs: number): string | null;
  /**
   * Crop the tracked face's bbox from the current video frame with a 20 %
   * padding, resize to 160x160 JPEG at quality 80, and return a plain
   * base64 string (no data URL prefix) + the original bbox.
   *
   * The resulting base64 payload is kept below the 200 KB WS limit per
   * API_SPEC §10.4 / §12.
   */
  cropFaceBase64(frameId: string): {
    b64: string;
    mime: "image/jpeg";
    bbox: BBox;
  } | null;
  /**
   * Crop a small thumbnail for the pending-faces queue (API_SPEC §3b.1).
   * Bbox is padded by 15 %, resized to 96x96 JPEG at quality 70 — ~3–5 KB
   * decoded, well under the 50 KB server cap. Returns the raw base64 (no
   * data-URL prefix) plus the MIME.
   */
  cropFaceThumbnailBase64(frameId: string): {
    b64: string;
    mime: "image/jpeg";
  } | null;
}

export interface VideoCanvasProps {
  /** Frame-id → overlay status, supplied by the App on every render. */
  statusByFrameId: Map<string, BoxStatus>;
  /** Invoked on each animation-frame with the current overlays. */
  onBoxes: (boxes: OverlayBox[]) => void;
  /** Fired when the video element has reported `loadedmetadata`. */
  onReady: () => void;
  /** Fired on permission denial, camera failure, or detector init failure. */
  onError: (err: Error) => void;
}

/** Tracked state snapshot — held in a ref so the RAF loop sees the latest. */
interface LastFrameSnapshot {
  tracked: TrackedDetection[];
  intrinsic: { w: number; h: number };
  timestampMs: number;
}

export const VideoCanvas = forwardRef<VideoCanvasHandle, VideoCanvasProps>(
  function VideoCanvas(props, ref): JSX.Element {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const trackerRef = useRef<IoUTracker>(new IoUTracker());
    const rafRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const lastFrameRef = useRef<LastFrameSnapshot | null>(null);
    // Mirror of the prop so the RAF loop (which captures stale closures) can
    // read the latest status map without re-subscribing.
    const statusRef = useRef<Map<string, BoxStatus>>(props.statusByFrameId);
    statusRef.current = props.statusByFrameId;
    const onBoxesRef = useRef(props.onBoxes);
    onBoxesRef.current = props.onBoxes;
    const onReadyRef = useRef(props.onReady);
    onReadyRef.current = props.onReady;
    const onErrorRef = useRef(props.onError);
    onErrorRef.current = props.onError;

    const drawOverlay = useCallback(
      (tracked: TrackedDetection[], videoW: number, videoH: number) => {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (canvas === null || video === null) return;
        const rect = video.getBoundingClientRect();
        // Size the backing store to the device pixel ratio so strokes stay
        // crisp on HiDPI displays.
        const dpr = window.devicePixelRatio || 1;
        const cssW = rect.width;
        const cssH = rect.height;
        if (
          canvas.width !== Math.floor(cssW * dpr) ||
          canvas.height !== Math.floor(cssH * dpr)
        ) {
          canvas.width = Math.floor(cssW * dpr);
          canvas.height = Math.floor(cssH * dpr);
        }
        canvas.style.width = `${cssW.toString()}px`;
        canvas.style.height = `${cssH.toString()}px`;

        const ctx = canvas.getContext("2d");
        if (ctx === null) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(dpr, dpr);

        // Video is `object-fit: cover`, so compute the same cover transform
        // to project bboxes (in intrinsic video coords) to CSS coords.
        const scale = Math.max(cssW / videoW, cssH / videoH);
        const renderedW = videoW * scale;
        const renderedH = videoH * scale;
        const offsetX = (cssW - renderedW) / 2;
        const offsetY = (cssH - renderedH) / 2;

        const statusMap = statusRef.current;
        const overlays: OverlayBox[] = [];
        const rootStyles = window.getComputedStyle(document.documentElement);
        const accent = rootStyles.getPropertyValue("--accent").trim() || "#D4A65A";
        const warm =
          rootStyles.getPropertyValue("--signal-warm").trim() || "#C6733D";

        ctx.lineWidth = 2;
        for (const t of tracked) {
          const status: BoxStatus =
            statusMap.get(t.frame_id) === "matched" ? "matched" : "unknown";
          ctx.strokeStyle = status === "matched" ? accent : warm;
          const x = offsetX + t.bbox.x * scale;
          const y = offsetY + t.bbox.y * scale;
          const w = t.bbox.w * scale;
          const h = t.bbox.h * scale;
          ctx.strokeRect(x, y, w, h);
          overlays.push({
            frame_id: t.frame_id,
            bbox: {
              x: Math.round(x),
              y: Math.round(y),
              w: Math.round(w),
              h: Math.round(h),
            },
            status,
            videoWidth: videoW,
            videoHeight: videoH,
            videoRect: rect,
          });
        }
        onBoxesRef.current(overlays);
      },
      [],
    );

    // Startup: camera + detector + RAF loop. Single-effect so cleanup is tidy.
    useEffect(() => {
      let cancelled = false;

      async function start(): Promise<void> {
        try {
          await detector.init();
        } catch (err) {
          if (!cancelled) {
            onErrorRef.current(
              err instanceof Error ? err : new Error("Detector init failed"),
            );
          }
          return;
        }
        if (cancelled) return;

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
        } catch (err) {
          if (!cancelled) {
            onErrorRef.current(
              err instanceof Error ? err : new Error("Camera access denied"),
            );
          }
          return;
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (video === null) {
          stream.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }
        video.srcObject = stream;
        video.muted = true;
        try {
          await video.play();
        } catch {
          // Autoplay policies should not block a muted video, but if they
          // do the user can still see the feed once interaction happens.
        }
        if (cancelled) return;
        onReadyRef.current();

        const tick = (): void => {
          if (cancelled) return;
          const videoEl = videoRef.current;
          if (videoEl !== null && videoEl.readyState >= 2) {
            const videoW = videoEl.videoWidth;
            const videoH = videoEl.videoHeight;
            if (videoW > 0 && videoH > 0) {
              const tsMs = performance.now();
              const detections = detector.detect(videoEl, tsMs);
              const tracked = trackerRef.current.update(detections);
              lastFrameRef.current = {
                tracked,
                intrinsic: { w: videoW, h: videoH },
                timestampMs: tsMs,
              };
              drawOverlay(tracked, videoW, videoH);
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }

      void start();

      return () => {
        cancelled = true;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (streamRef.current !== null) {
          streamRef.current.getTracks().forEach((t) => {
            t.stop();
          });
          streamRef.current = null;
        }
        trackerRef.current.reset();
      };
    }, [drawOverlay]);

    useImperativeHandle(
      ref,
      (): VideoCanvasHandle => ({
        pickFocusFace(staleBeforeMs: number): string | null {
          const snap = lastFrameRef.current;
          if (snap === null || snap.tracked.length === 0) return null;
          const statusMap = statusRef.current;
          // Prefer unknowns; fall back to matched-but-stale.
          // Staleness is delegated to the parent via `staleBeforeMs`: the
          // App calls us passing "now - 2000 ms" to mean "stale if match
          // is older than 2 s" (PIPELINE §1.2 step 16).
          const unknowns: TrackedDetection[] = [];
          const stale: TrackedDetection[] = [];
          for (const t of snap.tracked) {
            const status = statusMap.get(t.frame_id);
            if (status !== "matched") {
              unknowns.push(t);
              continue;
            }
            if (snap.timestampMs < staleBeforeMs) stale.push(t);
          }
          const pool = unknowns.length > 0 ? unknowns : stale;
          if (pool.length === 0) return null;
          let best: TrackedDetection = pool[0];
          let bestArea = best.bbox.w * best.bbox.h;
          for (let i = 1; i < pool.length; i += 1) {
            const area = pool[i].bbox.w * pool[i].bbox.h;
            if (area > bestArea) {
              best = pool[i];
              bestArea = area;
            }
          }
          return best.frame_id;
        },

        cropFaceBase64(frameId: string): {
          b64: string;
          mime: "image/jpeg";
          bbox: BBox;
        } | null {
          const snap = lastFrameRef.current;
          const video = videoRef.current;
          if (snap === null || video === null) return null;
          const t = snap.tracked.find((d) => d.frame_id === frameId);
          if (t === undefined) return null;

          const vw = snap.intrinsic.w;
          const vh = snap.intrinsic.h;
          if (vw === 0 || vh === 0) return null;

          // Apply 20 % padding around the bbox; clamp to frame.
          const padX = t.bbox.w * 0.2;
          const padY = t.bbox.h * 0.2;
          const sx = Math.max(0, Math.floor(t.bbox.x - padX));
          const sy = Math.max(0, Math.floor(t.bbox.y - padY));
          const sw = Math.min(vw - sx, Math.ceil(t.bbox.w + 2 * padX));
          const sh = Math.min(vh - sy, Math.ceil(t.bbox.h + 2 * padY));
          if (sw <= 0 || sh <= 0) return null;

          const off = document.createElement("canvas");
          off.width = 160;
          off.height = 160;
          const ctx = off.getContext("2d");
          if (ctx === null) return null;
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 160, 160);
          const dataUrl = off.toDataURL("image/jpeg", 0.8);
          const commaIdx = dataUrl.indexOf(",");
          if (commaIdx < 0) return null;
          const b64 = dataUrl.slice(commaIdx + 1);
          return {
            b64,
            mime: "image/jpeg",
            bbox: {
              x: Math.round(t.bbox.x),
              y: Math.round(t.bbox.y),
              w: Math.round(t.bbox.w),
              h: Math.round(t.bbox.h),
            },
          };
        },

        cropFaceThumbnailBase64(frameId: string): {
          b64: string;
          mime: "image/jpeg";
        } | null {
          const snap = lastFrameRef.current;
          const video = videoRef.current;
          if (snap === null || video === null) return null;
          const t = snap.tracked.find((d) => d.frame_id === frameId);
          if (t === undefined) return null;

          const vw = snap.intrinsic.w;
          const vh = snap.intrinsic.h;
          if (vw === 0 || vh === 0) return null;

          // 15 % padding around the bbox — slightly tighter than the
          // recognition crop so the Dashboard preview focuses on the face.
          const padX = t.bbox.w * 0.15;
          const padY = t.bbox.h * 0.15;
          const sx = Math.max(0, Math.floor(t.bbox.x - padX));
          const sy = Math.max(0, Math.floor(t.bbox.y - padY));
          const sw = Math.min(vw - sx, Math.ceil(t.bbox.w + 2 * padX));
          const sh = Math.min(vh - sy, Math.ceil(t.bbox.h + 2 * padY));
          if (sw <= 0 || sh <= 0) return null;

          const off = document.createElement("canvas");
          off.width = 96;
          off.height = 96;
          const ctx = off.getContext("2d");
          if (ctx === null) return null;
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 96, 96);
          const dataUrl = off.toDataURL("image/jpeg", 0.7);
          const commaIdx = dataUrl.indexOf(",");
          if (commaIdx < 0) return null;
          const b64 = dataUrl.slice(commaIdx + 1);
          return { b64, mime: "image/jpeg" };
        },
      }),
      [],
    );

    return (
      <>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="fixed inset-0"
          style={{
            width: "100vw",
            height: "100vh",
            objectFit: "cover",
            background: "var(--bg-base)",
          }}
        />
        <canvas
          ref={canvasRef}
          className="fixed inset-0 pointer-events-none"
          style={{
            width: "100vw",
            height: "100vh",
          }}
          aria-hidden="true"
        />
      </>
    );
  },
);

export default VideoCanvas;
