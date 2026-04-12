// Vision SPA orchestrator.
//
// Responsibilities (plan Task V3 Step 9, FRONTEND_SPEC §1.2/§1.7):
//   1. Gate on the URL-delivered session (PIPELINE §6.3); missing → Error.
//   2. Render BootScreen until the camera is ready AND the WS handed us
//      session_ready.
//   3. Open ws_client; wire callbacks to patient-scoped match state.
//   4. Each RAF-ish tick, ask VideoCanvas for a focus face and, if the
//      500 ms throttle allows, send a WS `recognize` with the cropped JPEG.
//   5. Compose IdentityCard + UnknownBadge layers over the live feed.
//   6. Handle voice trigger ("who is this") → TTS → audio_player.
//   7. Handle reminder firing (PIPELINE §3.3) → TTS + ReminderCard.
//   8. Start conversation capture (PIPELINE §2.1) supplying the last-10 s
//      matched face_ids.
//   9. Render AudioIndicator (self-subscribed) always.
//
// Cleanup on unmount closes the WS, stops voice/conversation/reminder
// listeners, and cancels audio playback.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AudioIndicator from "./components/AudioIndicator";
import BootScreen from "./components/BootScreen";
import ErrorScreen from "./components/ErrorScreen";
import IdentityCard from "./components/IdentityCard";
import ReminderCard from "./components/ReminderCard";
import UnknownBadge from "./components/UnknownBadge";
import VideoCanvas, {
  type BoxStatus,
  type OverlayBox,
  type VideoCanvasHandle,
} from "./components/VideoCanvas";

import * as audioPlayer from "./services/audio_player";
import * as conversationCapture from "./services/conversation_capture";
import * as reminderPoller from "./services/reminder_poller";
import { submitPendingFace, tts } from "./services/rest_client";
import { getPatientId, hasSession } from "./services/session";
import * as voiceTrigger from "./services/voice_trigger";
import { RECOGNIZE_THROTTLE_MS, WsClient } from "./services/ws_client";

import type {
  Id,
  RecognitionResultMessage,
  ReminderObject,
} from "./types/api";

type AppState = "booting" | "ready" | "error";

interface MatchInfo {
  face_id: Id;
  name: string;
  title: string | null;
  memorySummary: string;
  /** ms since epoch; the match decays 3 s after receipt per FRONTEND_SPEC §1.3. */
  expiresAt: number;
}

interface PendingUnknown {
  embedding: number[];
  lastSeen: number;
}

interface ActiveReminder {
  /** Unique key so a new reminder re-mounts the card and restarts timers. */
  instanceKey: string;
  title: string;
  description: string | null;
}

interface ErrorInfo {
  title: string;
  message: string;
  canRetry: boolean;
}

/** Match lifetime — FRONTEND_SPEC §1.3 "3 s after last matching result". */
const MATCH_LIFETIME_MS = 3_000;
/** Recent-match window for conversation_capture (PIPELINE §2.1 step 5). */
const RECENT_MATCH_WINDOW_MS = 10_000;
/** Global cooldown between ANY pending-face POST — prevents the IoU tracker
 *  reassigning frame_ids from spamming the queue with the same person. */
const PENDING_FACE_GLOBAL_COOLDOWN_MS = 30_000;
/** Cosine similarity threshold for client-side dedup against recent submissions. */
const PENDING_FACE_CLIENT_DEDUP_THRESHOLD = 0.80;

export function App(): JSX.Element {
  const [appState, setAppState] = useState<AppState>("booting");
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [activeReminder, setActiveReminder] = useState<ActiveReminder | null>(
    null,
  );
  // Drives a re-render whenever the match maps mutate. We keep the source
  // of truth in refs (fast path for the RAF loop) and bump this on change.
  const [renderTick, setRenderTick] = useState(0);
  const bumpRender = useCallback(() => {
    setRenderTick((n) => n + 1);
  }, []);

  const [overlays, setOverlays] = useState<OverlayBox[]>([]);

  // Refs — hot-path state the RAF loop + WS callbacks read/write without
  // triggering React re-renders.
  const lastMatchByFrameIdRef = useRef<Map<string, MatchInfo>>(new Map());
  const pendingByFrameIdRef = useRef<Map<string, PendingUnknown>>(new Map());
  const lastRecognizeSentAtRef = useRef<number>(0);
  /** frame_id → last time we shipped a crop. Used to mark "stale" faces. */
  const lastMatchReceivedAtByFrameIdRef = useRef<Map<string, number>>(
    new Map(),
  );
  /** Timestamp of the last successful pending-face POST (global cooldown). */
  const lastPendingSubmitAtRef = useRef<number>(0);
  /** Recent embeddings we already submitted — small ring buffer for client-side dedup. */
  const recentPendingEmbeddingsRef = useRef<number[][]>([]);
  const videoCanvasRef = useRef<VideoCanvasHandle | null>(null);
  const wsRef = useRef<WsClient | null>(null);
  const msgCounterRef = useRef<number>(0);
  const sessionOkRef = useRef<boolean>(hasSession());

  // ---------------------------------------------------------------------
  // Session gate (plan Step 9.1)
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!sessionOkRef.current) {
      setErrorInfo({
        title: "Launch from Dashboard",
        message:
          "This screen is meant to be opened from the RememberMe Dashboard so it can share your sign-in.",
        canRetry: false,
      });
      setAppState("error");
    }
  }, []);

  // ---------------------------------------------------------------------
  // WS + recognition callbacks (plan Step 9.3)
  // ---------------------------------------------------------------------
  const handleRecognitionResult = useCallback(
    (msg: RecognitionResultMessage) => {
      const now = Date.now();
      lastMatchReceivedAtByFrameIdRef.current.set(msg.frame_id, now);
      if (msg.matched) {
        lastMatchByFrameIdRef.current.set(msg.frame_id, {
          face_id: msg.face_id,
          name: msg.name,
          title: msg.title,
          memorySummary: msg.recent_memory_summary,
          expiresAt: now + MATCH_LIFETIME_MS,
        });
        pendingByFrameIdRef.current.delete(msg.frame_id);
        voiceTrigger.noteRecognitionMatch();
      } else {
        lastMatchByFrameIdRef.current.delete(msg.frame_id);
        pendingByFrameIdRef.current.set(msg.frame_id, {
          embedding: msg.embedding,
          lastSeen: now,
        });

        // Surface the unknown face to the caretaker-facing pending queue
        // (PIPELINE §1.6 steps 42–46). Global cooldown + client-side cosine
        // dedup prevents the same person generating 5-10 entries when the
        // IoU tracker reassigns frame_ids.
        if (msg.embedding.length === 512) {
          const patientId = getPatientId();
          if (patientId !== null) {
            const sinceLastSubmit = now - lastPendingSubmitAtRef.current;
            // Client-side cosine dedup: skip if similar to a recent submission.
            const isDuplicate = recentPendingEmbeddingsRef.current.some((prev) => {
              let dot = 0;
              for (let i = 0; i < 512; i++) dot += prev[i] * msg.embedding[i];
              return dot >= PENDING_FACE_CLIENT_DEDUP_THRESHOLD;
            });
            if (sinceLastSubmit >= PENDING_FACE_GLOBAL_COOLDOWN_MS && !isDuplicate) {
              const handle = videoCanvasRef.current;
              const thumb = handle?.cropFaceThumbnailBase64(msg.frame_id) ?? null;
              if (thumb !== null) {
                lastPendingSubmitAtRef.current = now;
                // Keep a small ring buffer of the last 5 submitted embeddings.
                const buf = recentPendingEmbeddingsRef.current;
                buf.push([...msg.embedding]);
                if (buf.length > 5) buf.shift();
                const capturedAt = new Date()
                  .toISOString()
                  .replace(/\.\d{3}Z$/, "Z");
                const frameId = msg.frame_id;
                void submitPendingFace(patientId, {
                  embedding: msg.embedding,
                  thumbnail_b64: thumb.b64,
                  thumbnail_mime: thumb.mime,
                  captured_at: capturedAt,
                })
                  .then((resp) => {
                    if (resp.already_known) {
                      pendingByFrameIdRef.current.delete(frameId);
                      bumpRender();
                    }
                  })
                  .catch((err: unknown) => {
                    console.warn("pending face submit failed:", err);
                  });
              }
            }
          }
        }
      }
      bumpRender();
    },
    [bumpRender],
  );

  useEffect(() => {
    if (!sessionOkRef.current) return;
    const ws = new WsClient({
      onSessionReady: () => {
        setWsReady(true);
      },
      onRecognitionResult: handleRecognitionResult,
      onWsError: () => {
        // Non-fatal WS errors (RATE_LIMITED, BAD_FRAME) are ignored at the
        // UI level; throttling is already enforced client-side.
      },
      onSessionError: () => {
        setErrorInfo({
          title: "Session Error",
          message:
            "We could not load your memory cache. Try relaunching from the Dashboard.",
          canRetry: true,
        });
        setAppState("error");
      },
      onClose: (code, _reason, fatal) => {
        if (!fatal) return;
        let title = "Connection Lost";
        let message =
          "The secure link to RememberMe was closed. Relaunch from the Dashboard.";
        if (code === 4401) {
          title = "Sign-in expired";
          message =
            "Your sign-in is no longer valid. Relaunch RememberMe from the Dashboard.";
        } else if (code === 4403) {
          title = "Access denied";
          message =
            "This patient cannot be viewed with the current sign-in.";
        } else if (code === 4409) {
          title = "Another session is open";
          message =
            "Only one RememberMe camera can run at a time. Close the other window and try again.";
        }
        setErrorInfo({ title, message, canRetry: true });
        setAppState("error");
      },
    });
    wsRef.current = ws;
    ws.connect();
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [handleRecognitionResult]);

  // ---------------------------------------------------------------------
  // App-state promotion (camera + WS ready → "ready")
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (appState === "error") return;
    if (cameraReady && wsReady) setAppState("ready");
    else setAppState("booting");
  }, [cameraReady, wsReady, appState]);

  // ---------------------------------------------------------------------
  // Voice trigger (plan Step 9.7 / PIPELINE §4)
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (appState !== "ready") return;
    voiceTrigger.start(() => {
      // Find the newest active match.
      const now = Date.now();
      let newest: MatchInfo | null = null;
      for (const info of lastMatchByFrameIdRef.current.values()) {
        if (info.expiresAt <= now) continue;
        if (newest === null || info.expiresAt > newest.expiresAt) newest = info;
      }
      if (newest === null) return;
      const titleText =
        newest.title !== null && newest.title.length > 0
          ? newest.title
          : "friend";
      const memoryText =
        newest.memorySummary.length > 0 ? ` ${newest.memorySummary}` : "";
      const text = `This is your ${titleText}, ${newest.name}.${memoryText}`;
      void (async (): Promise<void> => {
        try {
          const blob = await tts(text);
          await audioPlayer.play(blob);
        } catch {
          // TTS failure is silent — the user still sees the card.
        }
      })();
    });
    return () => {
      voiceTrigger.stop();
    };
  }, [appState]);

  // ---------------------------------------------------------------------
  // Reminder poller (plan Step 9.8 / PIPELINE §3)
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (appState !== "ready") return;
    const patientId = getPatientId();
    if (patientId === null) return;
    reminderPoller.start(patientId, (r: ReminderObject) => {
      setActiveReminder({
        instanceKey: `${r.reminder_id}-${Date.now().toString(36)}`,
        title: r.title,
        description: r.description,
      });
      const descText =
        r.description !== null && r.description.length > 0
          ? ` ${r.description}`
          : "";
      const text = `Reminder: ${r.title}.${descText}`;
      void (async (): Promise<void> => {
        try {
          const blob = await tts(text);
          await audioPlayer.play(blob);
        } catch {
          // TTS failure is silent.
        }
      })();
    });
    return () => {
      reminderPoller.stop();
    };
  }, [appState]);

  // ---------------------------------------------------------------------
  // Conversation capture (plan Step 9.9 / PIPELINE §2)
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (appState !== "ready") return;
    const patientId = getPatientId();
    if (patientId === null) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        await conversationCapture.start(patientId, {
          getRecentFaceIds: (): Id[] => {
            const now = Date.now();
            const cutoff = now - RECENT_MATCH_WINDOW_MS;
            const seen = new Set<Id>();
            for (const info of lastMatchByFrameIdRef.current.values()) {
              if (info.expiresAt > cutoff) seen.add(info.face_id);
            }
            return Array.from(seen);
          },
        });
      } catch {
        // Mic permission denied or VAD init failed. The rest of the UI is
        // unaffected; conversation ingest simply doesn't happen.
      }
    })();
    return () => {
      cancelled = true;
      void conversationCapture.stop();
      if (cancelled) {
        /* no-op, silences unused-var warning if the start promise resolved
           after unmount */
      }
    };
  }, [appState]);

  // ---------------------------------------------------------------------
  // Global cleanup — stop audio on unmount.
  // ---------------------------------------------------------------------
  useEffect(() => {
    return () => {
      audioPlayer.stop();
    };
  }, []);

  // ---------------------------------------------------------------------
  // Status map fed to VideoCanvas (drives bbox color).
  // ---------------------------------------------------------------------
  const statusByFrameId = useMemo<Map<string, BoxStatus>>(() => {
    const now = Date.now();
    const out = new Map<string, BoxStatus>();
    for (const [frameId, info] of lastMatchByFrameIdRef.current) {
      if (info.expiresAt > now) out.set(frameId, "matched");
    }
    return out;
    // `renderTick` is the trigger; we want the ref read to be fresh.
  }, [renderTick, overlays]);

  // ---------------------------------------------------------------------
  // Overlay boxes (from VideoCanvas each frame).
  // ---------------------------------------------------------------------
  const handleBoxes = useCallback(
    (boxes: OverlayBox[]) => {
      setOverlays(boxes);

      // After each frame, attempt a throttled recognize send.
      const now = performance.now();
      if (now - lastRecognizeSentAtRef.current < RECOGNIZE_THROTTLE_MS) return;
      const handle = videoCanvasRef.current;
      const ws = wsRef.current;
      if (handle === null || ws === null || !ws.isOpen) return;
      // "Stale" is anything whose last server ack is older than 2 s ago.
      const staleBeforeMs = now - 2_000;
      const focusFrameId = handle.pickFocusFace(staleBeforeMs);
      if (focusFrameId === null) return;
      const crop = handle.cropFaceBase64(focusFrameId);
      if (crop === null) return;
      msgCounterRef.current += 1;
      const sent = ws.sendRecognize({
        type: "recognize",
        msg_id: `c-${msgCounterRef.current.toString(36)}`,
        frame_id: focusFrameId,
        captured_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        image_b64: crop.b64,
        image_mime: crop.mime,
        bbox: crop.bbox,
      });
      if (sent) lastRecognizeSentAtRef.current = now;
    },
    [],
  );

  const handleCameraReady = useCallback(() => {
    setCameraReady(true);
  }, []);

  const handleCameraError = useCallback((err: Error) => {
    setErrorInfo({
      title: "Camera unavailable",
      message:
        err.message.length > 0
          ? err.message
          : "Please allow camera access and try again.",
      canRetry: true,
    });
    setAppState("error");
  }, []);

  const handleReminderDismiss = useCallback(() => {
    setActiveReminder(null);
  }, []);

  const handleRetry = useCallback(() => {
    // Hackathon: a reload is the simplest way to re-run the full boot
    // sequence (camera prompt, WS open, service starts).
    window.location.reload();
  }, []);

  // ---------------------------------------------------------------------
  // Derive render-relevant data.
  // ---------------------------------------------------------------------
  // Cull expired matches lazily on render. Keeps the maps small over time.
  const nowMs = Date.now();
  for (const [frameId, info] of lastMatchByFrameIdRef.current) {
    if (info.expiresAt <= nowMs) lastMatchByFrameIdRef.current.delete(frameId);
  }

  // One IdentityCard at a time — pick the newest active match (FRONTEND_SPEC
  // §1.4 "Max 1 identity card"). Ties broken by frame_id comparison.
  let newestMatch: { frameId: string; info: MatchInfo } | null = null;
  for (const [frameId, info] of lastMatchByFrameIdRef.current) {
    if (newestMatch === null || info.expiresAt > newestMatch.info.expiresAt) {
      newestMatch = { frameId, info };
    }
  }
  const matchOverlay =
    newestMatch !== null
      ? overlays.find((o) => o.frame_id === newestMatch!.frameId) ?? null
      : null;

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (appState === "error" && errorInfo !== null) {
    return (
      <ErrorScreen
        title={errorInfo.title}
        message={errorInfo.message}
        onRetry={errorInfo.canRetry ? handleRetry : undefined}
      />
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      {sessionOkRef.current ? (
        <VideoCanvas
          ref={videoCanvasRef}
          statusByFrameId={statusByFrameId}
          onBoxes={handleBoxes}
          onReady={handleCameraReady}
          onError={handleCameraError}
        />
      ) : null}

      {appState === "booting" ? <BootScreen /> : null}

      {appState === "ready" && matchOverlay !== null && newestMatch !== null ? (
        <IdentityCard
          name={newestMatch.info.name}
          title={newestMatch.info.title}
          memorySummary={newestMatch.info.memorySummary}
          bbox={matchOverlay.bbox}
          videoRect={matchOverlay.videoRect}
        />
      ) : null}

      {appState === "ready"
        ? overlays
            .filter(
              (o) =>
                pendingByFrameIdRef.current.has(o.frame_id) &&
                !lastMatchByFrameIdRef.current.has(o.frame_id),
            )
            .map((o) => (
              <UnknownBadge
                key={o.frame_id}
                bbox={o.bbox}
                videoRect={o.videoRect}
              />
            ))
        : null}

      {appState === "ready" && activeReminder !== null ? (
        <ReminderCard
          key={activeReminder.instanceKey}
          title={activeReminder.title}
          description={activeReminder.description}
          onDismiss={handleReminderDismiss}
        />
      ) : null}

      <AudioIndicator />
    </div>
  );
}

export default App;
