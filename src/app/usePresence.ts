import { useEffect, useRef, useState } from "react";

// Cloudflare's free KV tier caps writes/lists at 1,000/day each, and every
// heartbeat costs one of each — keep this interval long, and skip
// heartbeats entirely while the tab is hidden, so an idle or backgrounded
// tab doesn't quietly burn through the daily quota.
const PRESENCE_HEARTBEAT_MS = 45_000;

export interface Presence {
  count: number | null;
  ids: readonly string[];
}

const SESSION_STORAGE_KEY = "openmouse-presence-session-id";

function readOrCreateSessionId(): string {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // sessionStorage can be unavailable in privacy-restricted contexts.
  }
  const created = crypto.randomUUID();
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, created);
  } catch {
    // Falls back to a fresh id every load if storage can't be used.
  }
  return created;
}

// Heartbeats "someone has this page open right now" to /api/presence.
// Mounted once near the app root (see control.tsx) so it runs whether the
// visitor is looking at the launch countdown or the full control app —
// tying this to a single screen means the admin dashboard only ever counts
// whoever happens to be stuck on that one screen.
export function usePresence(): Presence & { sessionId: string } {
  const [presence, setPresence] = useState<Presence>({ count: null, ids: [] });
  const sessionId = useRef<string>();
  // sessionStorage (not a plain ref) so the same tab keeps its identity
  // across reloads instead of registering as a brand-new visitor each time.
  if (!sessionId.current) sessionId.current = readOrCreateSessionId();

  useEffect(() => {
    let cancelled = false;
    const beat = () => {
      if (document.hidden) return;
      fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!cancelled && data && typeof data.count === "number" && Array.isArray(data.ids)) {
            setPresence({ count: data.count, ids: data.ids });
          }
        })
        .catch(() => undefined);
    };
    beat();
    document.addEventListener("visibilitychange", beat);
    const id = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", beat);
      window.clearInterval(id);
    };
  }, []);

  return { ...presence, sessionId: sessionId.current };
}
