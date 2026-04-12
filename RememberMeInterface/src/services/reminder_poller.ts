// Reminder polling + firing.
//
// PIPELINE.md §3:
//   - Every 30 s: GET /api/patients/{id}/reminders/upcoming?window_seconds=600.
//   - Merge the server list into local state keyed by reminder_id. Drop
//     entries the server no longer returns.
//   - Each 1 s: iterate local state. If `trigger_at - now ≤ 300 s` and we
//     haven't fired this reminder in-session, mark it fired and invoke
//     `onFire` (App handles the card + TTS).
//
// The `firedIds` set is session-scoped and never cleared during a session,
// so a reminder edit that keeps the same id but shifts the time will NOT
// re-fire. Matches §3.4 of the pipeline doc.

import type { Id, ReminderObject } from "../types/api";
import { getUpcomingReminders } from "./rest_client";

/** CLAUDE.md §5 constants. */
const POLL_INTERVAL_MS = 30_000;
const TICK_INTERVAL_MS = 1_000;
const FIRE_WINDOW_SECONDS = 300;

type Handle = {
  pollTimer: ReturnType<typeof setInterval>;
  fireTimer: ReturnType<typeof setInterval>;
  upcoming: Map<Id, ReminderObject>;
  fired: Set<Id>;
  patientId: Id;
  onFire: (r: ReminderObject) => void;
  /** Guards against overlapping polls if one takes longer than 30 s. */
  pollInFlight: boolean;
};

let handle: Handle | null = null;

function parseIso(iso: string): number {
  return Date.parse(iso);
}

async function poll(h: Handle): Promise<void> {
  if (h.pollInFlight) return;
  h.pollInFlight = true;
  try {
    const res = await getUpcomingReminders(h.patientId);
    const next = new Map<Id, ReminderObject>();
    for (const r of res.reminders) next.set(r.reminder_id, r);
    // Replace local map with the server view. `firedIds` is preserved so a
    // reminder we already fired stays "fired" even if the server still
    // returns it in a later poll (PIPELINE.md §3.3 step 14).
    h.upcoming = next;
  } catch {
    // Transient network error — keep the previous list. The 1 Hz tick still
    // fires against stale state, which is a deliberate trade-off (we'd
    // rather fire a slightly-stale reminder than miss one).
  } finally {
    h.pollInFlight = false;
  }
}

function tick(h: Handle): void {
  if (h.upcoming.size === 0) return;
  const nowMs = Date.now();
  for (const reminder of h.upcoming.values()) {
    if (h.fired.has(reminder.reminder_id)) continue;
    const triggerMs = parseIso(reminder.trigger_at);
    if (Number.isNaN(triggerMs)) continue;
    const deltaSeconds = (triggerMs - nowMs) / 1000;
    if (deltaSeconds <= FIRE_WINDOW_SECONDS) {
      h.fired.add(reminder.reminder_id);
      try {
        h.onFire(reminder);
      } catch {
        // Never let a listener crash the tick loop.
      }
    }
  }
}

/**
 * Start polling for the given patient. Invokes `onFire` once per reminder as
 * it enters the T-5min window. Idempotent: a second call replaces the first.
 */
export function start(
  patientId: Id,
  onFire: (r: ReminderObject) => void,
): void {
  stop();
  const h: Handle = {
    pollTimer: setInterval(() => {
      void poll(h);
    }, POLL_INTERVAL_MS),
    fireTimer: setInterval(() => {
      tick(h);
    }, TICK_INTERVAL_MS),
    upcoming: new Map(),
    fired: new Set(),
    patientId,
    onFire,
    pollInFlight: false,
  };
  handle = h;
  // Kick off an immediate poll so the first fire can happen within the
  // first second rather than waiting up to 30 s.
  void poll(h);
}

/** Stop polling and firing. Safe to call multiple times. */
export function stop(): void {
  if (handle === null) return;
  clearInterval(handle.pollTimer);
  clearInterval(handle.fireTimer);
  handle = null;
}

/** True if polling is currently active. */
export function isRunning(): boolean {
  return handle !== null;
}
