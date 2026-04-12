// WebSocket client for /ws/recognize.
//
// Contract: API_SPEC.md §10. Pipeline: PIPELINE.md §1.
//
// Responsibilities:
//  - Open `${VITE_BACKEND_WS}/ws/recognize?token=...&patient_id=...`.
//  - Deliver typed server frames via callbacks.
//  - Enforce the 500 ms client-side throttle on outgoing `recognize` frames
//    (API_SPEC §10.4 / CLAUDE.md §5). We MUST NOT send if too soon; the
//    excess is dropped silently, which is what the docs prescribe.
//  - Send a `ping` every 30 s (API_SPEC §10.6, FRONTEND_SPEC §1.5).
//  - Reconnect with exponential backoff on transient closes (1006, 1011).
//    Do NOT reconnect on auth/authorization/duplicate closes (4401, 4403,
//    4409) or on a fatal session error (4500) — the operator must relaunch
//    from the Dashboard.

import { getPatientId, getToken } from "./session";
import type {
  PingMessage,
  RecognitionResultMessage,
  RecognizeMessage,
  SessionErrorMessage,
  SessionReadyMessage,
  WsClientMessage,
  WsErrorMessage,
  WsServerMessage,
} from "../types/api";

const WS_BASE: string = import.meta.env.VITE_BACKEND_WS ?? "";

/** Client-side throttle window; matches server throttle (CLAUDE.md §5). */
export const RECOGNIZE_THROTTLE_MS = 500;
/** Keep-alive period (API_SPEC §10.6). */
const PING_INTERVAL_MS = 30_000;

/** Backoff schedule for 1006 / 1011 closes. Last value is repeated. */
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/** Close codes we treat as fatal — do not reconnect. */
const FATAL_CLOSE_CODES = new Set<number>([4401, 4403, 4409, 4500]);

export interface WsClientCallbacks {
  onOpen?: () => void;
  onSessionReady?: (msg: SessionReadyMessage) => void;
  onRecognitionResult?: (msg: RecognitionResultMessage) => void;
  onWsError?: (msg: WsErrorMessage) => void;
  onSessionError?: (msg: SessionErrorMessage) => void;
  /** Fired on every non-reconnecting close. `reason` is best-effort. */
  onClose?: (code: number, reason: string, fatal: boolean) => void;
}

function isWsServerMessage(v: unknown): v is WsServerMessage {
  if (typeof v !== "object" || v === null) return false;
  const t = (v as { type?: unknown }).type;
  return (
    t === "session_ready" ||
    t === "session_error" ||
    t === "recognition_result" ||
    t === "pong" ||
    t === "error"
  );
}

export class WsClient {
  private ws: WebSocket | null = null;
  private callbacks: WsClientCallbacks;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastRecognizeSentAt = 0;
  private stopped = false;

  constructor(callbacks: WsClientCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /** Open the WebSocket. Idempotent while already open. */
  connect(): void {
    if (this.stopped) return;
    if (this.ws !== null) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        return;
      }
    }
    const token = getToken();
    const patientId = getPatientId();
    if (token === null || patientId === null) {
      // Cannot open without a session — surface as a fatal "close".
      this.callbacks.onClose?.(4401, "missing_session", true);
      return;
    }
    const url =
      `${WS_BASE}/ws/recognize` +
      `?token=${encodeURIComponent(token)}` +
      `&patient_id=${encodeURIComponent(patientId)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.startPingTimer();
      this.callbacks.onOpen?.();
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!isWsServerMessage(parsed)) return;
      switch (parsed.type) {
        case "session_ready":
          this.callbacks.onSessionReady?.(parsed);
          break;
        case "session_error":
          this.callbacks.onSessionError?.(parsed);
          break;
        case "recognition_result":
          this.callbacks.onRecognitionResult?.(parsed);
          break;
        case "error":
          this.callbacks.onWsError?.(parsed);
          break;
        case "pong":
          // No-op; ping/pong is keep-alive only.
          break;
      }
    });

    ws.addEventListener("close", (ev: CloseEvent) => {
      this.stopPingTimer();
      this.ws = null;
      // Client-initiated close (`this.stopped`) is an intentional teardown —
      // e.g. a React effect cleanup on unmount or StrictMode double-invoke.
      // Do NOT surface it to the UI or schedule a reconnect; the caller that
      // asked us to stop already knows.
      if (this.stopped) return;
      const fatal = FATAL_CLOSE_CODES.has(ev.code);
      this.callbacks.onClose?.(ev.code, ev.reason, fatal);
      if (!fatal) this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // The `close` event fires after `error` with an appropriate code
      // (typically 1006). Reconnect logic lives there.
    });
  }

  /** Permanently stop the client. No further reconnect attempts. */
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPingTimer();
    if (this.ws !== null) {
      try {
        this.ws.close(1000, "client_close");
      } catch {
        // Ignore — socket may already be closing.
      }
      this.ws = null;
    }
  }

  /** True while the socket is OPEN. */
  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send a `recognize` frame.
   *
   * Enforces the 500 ms throttle in-client. Returns `true` if the frame was
   * queued on the wire, `false` if the caller should drop it silently. This
   * mirrors the server-side throttle in API_SPEC §10.4 so the client never
   * earns a RATE_LIMITED reply in steady state.
   */
  sendRecognize(msg: RecognizeMessage): boolean {
    const now = performance.now();
    if (now - this.lastRecognizeSentAt < RECOGNIZE_THROTTLE_MS) return false;
    if (!this.isOpen) return false;
    this.lastRecognizeSentAt = now;
    this.sendRaw(msg);
    return true;
  }

  /** Send a `ping` frame. Caller-controlled; also invoked internally. */
  sendPing(msg: PingMessage): void {
    if (!this.isOpen) return;
    this.sendRaw(msg);
  }

  private sendRaw(msg: WsClientMessage): void {
    if (this.ws === null) return;
    this.ws.send(JSON.stringify(msg));
  }

  private startPingTimer(): void {
    this.stopPingTimer();
    this.pingTimer = setInterval(() => {
      if (!this.isOpen) return;
      const ping: PingMessage = {
        type: "ping",
        msg_id: `c-p-${Date.now().toString(36)}`,
      };
      this.sendRaw(ping);
    }, PING_INTERVAL_MS);
  }

  private stopPingTimer(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const idx = Math.min(this.reconnectAttempt, BACKOFF_SCHEDULE_MS.length - 1);
    const delay = BACKOFF_SCHEDULE_MS[idx];
    this.reconnectAttempt += 1;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
