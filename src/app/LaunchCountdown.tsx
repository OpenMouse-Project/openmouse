import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  isBeforeLaunch,
  millisecondsUntilLaunch,
} from "../launch";
import {
  DISCORD_URL,
  DiscordIcon,
  formatCount,
  GITHUB_URL,
  GitHubIcon,
  StarIcon,
  TWITTER_URL,
  TwitterIcon,
  useGitHubStars,
} from "./social-links";

// Cloudflare's free KV tier caps writes/lists at 1,000/day each, and every
// heartbeat costs one of each — keep this interval long, and skip
// heartbeats entirely while the tab is hidden, so an idle or backgrounded
// tab doesn't quietly burn through the daily quota.
const PRESENCE_HEARTBEAT_MS = 45_000;

interface Presence {
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

function usePresence(): Presence & { sessionId: string } {
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

function LaunchSocials({ viewers }: { viewers: number | null }): ReactNode {
  const stars = useGitHubStars();

  return (
    <footer className="launch-socials">
      <a href={DISCORD_URL} target="_blank" rel="noreferrer" title="Discord" aria-label="OpenMouse on Discord">
        <DiscordIcon />
      </a>
      <a href={TWITTER_URL} target="_blank" rel="noreferrer" title="Twitter" aria-label="OpenMouse on Twitter">
        <TwitterIcon />
      </a>
      <a
        className="launch-social-stars"
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        title="GitHub"
        aria-label="OpenMouse on GitHub"
      >
        <GitHubIcon />
        {stars !== null && (
          <span className="launch-star-count">
            <StarIcon />
            {formatCount(stars)}
          </span>
        )}
      </a>
      {viewers !== null && viewers > 0 && (
        <span className="launch-viewers" title="People on this page right now">
          <i className="launch-viewers-dot" aria-hidden="true" />
          {viewers} watching now
        </span>
      )}
    </footer>
  );
}

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function split(ms: number): Remaining {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

function Digit({ value, label }: { value: number; label: string }): ReactNode {
  return (
    <div className="launch-digit" aria-label={`${value} ${label}`}>
      <span className="launch-digit-value" aria-hidden="true">{pad(value)}</span>
      <span className="launch-digit-label">{label}</span>
    </div>
  );
}

function LaunchStage({ children }: { children: ReactNode }): ReactNode {
  // Pixel critters are disabled for now (positioning/sync issues) — this
  // still keeps the live viewer count in the socials footer.
  const { count } = usePresence();

  return (
    <>
      <div className="launch-stage">
        <div className="launch-brand">
          <img src="/logo.png" alt="" width={28} height={41} />
          OpenMouse
        </div>
        {children}
      </div>
      <LaunchSocials viewers={count} />
    </>
  );
}

export function LaunchCountdown(): ReactNode {
  const [now, setNow] = useState<number>(() => Date.now());
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (!isBeforeLaunch(current)) setCelebrating(true);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = useMemo(() => split(millisecondsUntilLaunch(now)), [now]);

  if (celebrating) {
    return (
      <LaunchStage>
        <section className="launch-hero is-go" aria-live="polite">
          <h1 className="launch-title">Early Access is live.</h1>
          <p className="launch-lead">
            OpenMouse Beta 1.0 is now available. Configure your mouse and get
            started.
          </p>
          <a className="launch-cta" href="/">Enter the app</a>
        </section>
      </LaunchStage>
    );
  }

  return (
    <LaunchStage>
      <section className="launch-hero" aria-live="polite">
        <h1 className="launch-title">Early Access launches soon.</h1>

        <div className="launch-timer" role="timer" aria-label="Time until launch">
          <Digit value={remaining.days} label="Days" />
          <span className="launch-colon" aria-hidden="true">:</span>
          <Digit value={remaining.hours} label="Hours" />
          <span className="launch-colon" aria-hidden="true">:</span>
          <Digit value={remaining.minutes} label="Minutes" />
          <span className="launch-colon" aria-hidden="true">:</span>
          <Digit value={remaining.seconds} label="Seconds" />
        </div>

        <p className="launch-lead">
          A free, open source mouse configurator &mdash; no vendor software.
        </p>
      </section>
    </LaunchStage>
  );
}
