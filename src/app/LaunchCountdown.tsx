import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  isBeforeLaunch,
  millisecondsUntilLaunch,
} from "../launch";

const GITHUB_REPO = "OpenMouse-Project/openmouse";
const DISCORD_URL = "https://discord.gg/yxC9jzMdw6";
const TWITTER_URL = "https://x.com/openmouseapp";
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
const PRESENCE_HEARTBEAT_MS = 6_000;
const CRITTER_POOF_MS = 420;

function DiscordIcon(): ReactNode {
  return (
    <svg viewBox="0 0 126.644 96" aria-hidden="true">
      <path fill="currentColor" d="M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z" />
    </svg>
  );
}

function TwitterIcon(): ReactNode {
  return (
    <svg viewBox="0 0 1200 1227" aria-hidden="true">
      <path fill="currentColor" d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" />
    </svg>
  );
}

function GitHubIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function StarIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="m8 .25 2.34 4.98 5.41.74-3.94 3.86.96 5.42L8 12.6l-4.77 2.65.96-5.42L.25 5.97l5.41-.74Z" />
    </svg>
  );
}

// A tiny pixel mouse (two ears, a round body, a little tail nub), drawn with
// a single box-shadow so one DOM node can render the whole sprite.
const CRITTER_BITMAP = [
  "0100001000",
  "0111111000",
  "1111111000",
  "1111111000",
  "0111111000",
];
const CRITTER_PIXEL_SIZE = 4;
const CRITTER_SHADOW = CRITTER_BITMAP.flatMap((row, y) =>
  [...row].flatMap((cell, x) => (cell === "1" ? [`${x * CRITTER_PIXEL_SIZE}px ${y * CRITTER_PIXEL_SIZE}px currentColor`] : [])),
).join(", ");
const CRITTER_WIDTH = CRITTER_BITMAP[0].length * CRITTER_PIXEL_SIZE;
const CRITTER_HEIGHT = CRITTER_BITMAP.length * CRITTER_PIXEL_SIZE;

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0;
  return hash;
}

// Deterministic wandering path for a given critter, as a function of time
// alone. Every visitor's browser computes the same curve from the same
// (seed, t), so critters appear to roam freely in sync without a server ever
// broadcasting positions.
function wanderPosition(seed: number, t: number): { x: number; y: number } {
  const speedA = 0.045 + (seed % 11) / 260;
  const speedB = 0.03 + ((seed >> 5) % 11) / 300;
  const phaseA = (seed % 6283) / 1000;
  const phaseB = ((seed >> 10) % 6283) / 1000;
  const x = 50 + 42 * Math.sin(t * speedA + phaseA);
  const y = 48 + 38 * Math.sin(t * speedB + phaseB) * Math.cos(t * speedA * 0.5 + phaseB);
  return { x: Math.min(94, Math.max(4, x)), y: Math.min(88, Math.max(8, y)) };
}

const REACTIONS = ["👀", "🔥", "🎉", "🐭", "👍"] as const;
type Reaction = (typeof REACTIONS)[number];
const BUBBLE_DISPLAY_MS = 3500;

interface Critter {
  id: string;
  leaving: boolean;
}

interface ReactionEvent {
  emoji: string;
  ts: number;
}

function CritterSprite({
  id,
  leaving,
  reaction,
  onPoofed,
  registerNode,
}: {
  id: string;
  leaving: boolean;
  reaction: ReactionEvent | undefined;
  onPoofed: () => void;
  registerNode: (id: string, node: HTMLDivElement | null) => void;
}): ReactNode {
  const hash = hashId(id);
  const hue = hash % 360;
  const [bubble, setBubble] = useState<string | null>(null);
  const seenReactionAt = useRef(0);

  const initial = wanderPosition(hash, 0);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(onPoofed, CRITTER_POOF_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onPoofed]);

  useEffect(() => {
    if (!reaction || reaction.ts === seenReactionAt.current) return undefined;
    seenReactionAt.current = reaction.ts;
    setBubble(reaction.emoji);
    const timer = window.setTimeout(() => setBubble(null), BUBBLE_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [reaction]);

  return (
    <div
      className="pixel-critter-walker"
      ref={(node) => registerNode(id, node)}
      style={{
        top: `${initial.y}%`,
        left: `${initial.x}%`,
        width: CRITTER_WIDTH,
        height: CRITTER_HEIGHT,
      }}
    >
      {bubble && <span className="critter-bubble">{bubble}</span>}
      <i
        className={`pixel-critter${leaving ? " is-leaving" : ""}`}
        style={{
          width: CRITTER_PIXEL_SIZE,
          height: CRITTER_PIXEL_SIZE,
          boxShadow: CRITTER_SHADOW,
          color: `hsl(${hue} 55% 62%)`,
        }}
        aria-hidden="true"
      />
    </div>
  );
}

function PixelCritters({ ids, reactions }: { ids: readonly string[]; reactions: Readonly<Record<string, ReactionEvent>> }): ReactNode {
  const [critters, setCritters] = useState<readonly Critter[]>([]);
  const previousIds = useRef<readonly string[]>([]);
  const nodes = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const previousSet = new Set(previousIds.current);
    const nextSet = new Set(ids);
    const joined = ids.filter((id) => !previousSet.has(id));
    const left = previousIds.current.filter((id) => !nextSet.has(id));
    previousIds.current = ids;

    if (!joined.length && !left.length) return;
    setCritters((current) => [
      ...current.map((critter) => (left.includes(critter.id) ? { ...critter, leaving: true } : critter)),
      ...joined.map((id) => ({ id, leaving: false })),
    ]);
  }, [ids]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      nodes.current.forEach((node, id) => {
        const { x, y } = wanderPosition(hashId(id), t);
        node.style.left = `${x}%`;
        node.style.top = `${y}%`;
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pixel-critters" aria-hidden="true">
      {critters.map((critter) => (
        <CritterSprite
          key={critter.id}
          id={critter.id}
          leaving={critter.leaving}
          reaction={reactions[critter.id]}
          onPoofed={() => setCritters((current) => current.filter((entry) => entry.id !== critter.id))}
          registerNode={(id, node) => {
            if (node) nodes.current.set(id, node);
            else nodes.current.delete(id);
          }}
        />
      ))}
    </div>
  );
}

function ReactionDock({ onReact }: { onReact: (reaction: Reaction) => void }): ReactNode {
  return (
    <div className="reaction-dock" aria-label="Send a reaction">
      {REACTIONS.map((emoji) => (
        <button key={emoji} type="button" className="reaction-button" onClick={() => onReact(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

function formatCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

function useGitHubStars(): number | null {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${GITHUB_REPO}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return stars;
}

interface Presence {
  count: number | null;
  ids: readonly string[];
  reactions: Readonly<Record<string, ReactionEvent>>;
}

function usePresence(): Presence & { sendReaction: (reaction: Reaction) => void } {
  const [presence, setPresence] = useState<Presence>({ count: null, ids: [], reactions: {} });
  const sessionId = useRef<string>();
  if (!sessionId.current) sessionId.current = crypto.randomUUID();
  const pendingReaction = useRef<Reaction | null>(null);

  const beat = useRef<() => void>();
  useEffect(() => {
    let cancelled = false;
    beat.current = () => {
      const reaction = pendingReaction.current;
      pendingReaction.current = null;
      fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, ...(reaction ? { reaction } : {}) }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!cancelled && data && typeof data.count === "number" && Array.isArray(data.ids)) {
            setPresence({ count: data.count, ids: data.ids, reactions: data.reactions ?? {} });
          }
        })
        .catch(() => undefined);
    };
    beat.current();
    const id = window.setInterval(() => beat.current?.(), PRESENCE_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const sendReaction = (reaction: Reaction) => {
    pendingReaction.current = reaction;
    beat.current?.();
  };

  return { ...presence, sendReaction };
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
  const { count, ids, reactions, sendReaction } = usePresence();

  return (
    <>
      <PixelCritters ids={ids} reactions={reactions} />
      <div className="launch-stage">
        <div className="launch-brand">
          <img src="/logo.png" alt="" width={28} height={41} />
          OpenMouse
        </div>
        {children}
      </div>
      <ReactionDock onReact={sendReaction} />
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
