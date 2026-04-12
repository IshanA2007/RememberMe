// IoU-based frame tracker.
//
// PIPELINE.md §1.2 step 13: "assign or re-use a local `frame_id` via IoU
// tracking against last frame." The tracker keeps an overlay's identity
// stable across detector flickers so the IdentityCard doesn't flash.
//
// Design:
//  - IoU threshold 0.3 for association (standard BlazeFace tracker default).
//  - A track survives up to 3 consecutive missed frames before being dropped.
//  - frame_ids are monotonically increasing strings of the form "f-N".

import type { FaceDetection } from "./detector";

export interface TrackedDetection extends FaceDetection {
  frame_id: string;
}

interface Track {
  frame_id: string;
  bbox: FaceDetection["bbox"];
  score: number;
  missed: number;
}

const IOU_THRESHOLD = 0.3;
const MAX_MISSED_FRAMES = 3;

function iou(
  a: FaceDetection["bbox"],
  b: FaceDetection["bbox"],
): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  if (union <= 0) return 0;
  return inter / union;
}

export class IoUTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  /** Reset all state; used when the camera restarts. */
  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }

  /**
   * Feed this frame's detections; returns the same detections with a stable
   * `frame_id` attached. Greedy matching by descending IoU — sufficient for
   * the single-to-few-face scenarios this product targets.
   */
  update(detections: FaceDetection[]): TrackedDetection[] {
    // Score every (track, detection) pair; collect those above threshold.
    const pairs: { trackIdx: number; detIdx: number; score: number }[] = [];
    for (let ti = 0; ti < this.tracks.length; ti += 1) {
      for (let di = 0; di < detections.length; di += 1) {
        const s = iou(this.tracks[ti].bbox, detections[di].bbox);
        if (s >= IOU_THRESHOLD) pairs.push({ trackIdx: ti, detIdx: di, score: s });
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    const assignedTracks = new Set<number>();
    const assignedDets = new Set<number>();
    const results: (TrackedDetection | null)[] = new Array(detections.length).fill(null);

    for (const { trackIdx, detIdx } of pairs) {
      if (assignedTracks.has(trackIdx) || assignedDets.has(detIdx)) continue;
      assignedTracks.add(trackIdx);
      assignedDets.add(detIdx);
      const track = this.tracks[trackIdx];
      const det = detections[detIdx];
      // Update track state.
      track.bbox = det.bbox;
      track.score = det.score;
      track.missed = 0;
      results[detIdx] = { ...det, frame_id: track.frame_id };
    }

    // Unmatched detections become new tracks.
    for (let di = 0; di < detections.length; di += 1) {
      if (assignedDets.has(di)) continue;
      const det = detections[di];
      const frame_id = `f-${this.nextId.toString()}`;
      this.nextId += 1;
      this.tracks.push({
        frame_id,
        bbox: det.bbox,
        score: det.score,
        missed: 0,
      });
      results[di] = { ...det, frame_id };
    }

    // Age unmatched tracks; drop those that exceeded the miss budget.
    const survivors: Track[] = [];
    for (let ti = 0; ti < this.tracks.length; ti += 1) {
      if (assignedTracks.has(ti)) {
        survivors.push(this.tracks[ti]);
        continue;
      }
      const aged: Track = { ...this.tracks[ti], missed: this.tracks[ti].missed + 1 };
      if (aged.missed < MAX_MISSED_FRAMES) survivors.push(aged);
    }
    this.tracks = survivors;

    // All detections are guaranteed to be assigned an entry above.
    return results.filter((r): r is TrackedDetection => r !== null);
  }

  /** Current track count — useful for debugging overlays. */
  get trackCount(): number {
    return this.tracks.length;
  }
}
