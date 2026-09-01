import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  isBeforeLaunch,
  millisecondsUntilLaunch,
} from "../launch";

const MASCOT_URL = "/miku-mascot.gif";
const MOUSE_ART_URL = "/attackshark-x3.png";
const DEVICE_IMAGE_BASE_URL = "https://pub-ac470fd1b7084597b8a4a45cfc3318fc.r2.dev/";

const MOUSE_ART = [
  `${DEVICE_IMAGE_BASE_URL}logitech-g502-x-plus.png`,
  `${DEVICE_IMAGE_BASE_URL}razer-viper-v3-pro.png`,
  `${DEVICE_IMAGE_BASE_URL}endgame-gear-op1-8k.png`,
  `${DEVICE_IMAGE_BASE_URL}pulsar-x2-v2.png`,
  `${DEVICE_IMAGE_BASE_URL}wlmouse-beast-max.png`,
  `${DEVICE_IMAGE_BASE_URL}vgn-dragonfly-f2.png`,
  `${DEVICE_IMAGE_BASE_URL}lamzu-maya-x.png`,
  `${DEVICE_IMAGE_BASE_URL}finalmouse-ulx.png`,
  MOUSE_ART_URL,
];

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

function DropDown({ value, label }: { value: number; label: string }): ReactNode {
  const text = pad(value);
  const [one, two] = [text[0] ?? "0", text[1] ?? "0"];
  return (
    <div className="launch-digit" aria-label={`${value} ${label}`}>
      <span className="launch-digit-inner" aria-hidden="true">
        {one}
        {two}
      </span>
      <span className="launch-digit-label">{label}</span>
    </div>
  );
}

const ROTATE_MS = 5000;
const FADE_MS = 1100;

function MouseArtLayer({
  src,
  active,
  onDone,
}: {
  src: string;
  active: boolean;
  onDone?: () => void;
}): ReactNode {
  const [entered, setEntered] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (active && !entered) {
      const frame = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(frame);
    }
    if (!active && entered && !doneRef.current) {
      doneRef.current = true;
      if (onDone) {
        const timer = window.setTimeout(onDone, FADE_MS);
        return () => window.clearTimeout(timer);
      }
    }
    return undefined;
  }, [active, entered, onDone]);

  return (
    <img
      className={`launch-mouse-art${entered && active ? " is-active" : ""}`}
      src={src}
      alt=""
      loading="eager"
      draggable={false}
    />
  );
}

function MouseArtStage(): ReactNode {
  const [stack, setStack] = useState<readonly number[]>([0]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStack((previous) => {
        const last = previous[previous.length - 1] ?? 0;
        const next = (last + 1) % MOUSE_ART.length;
        const after = [...previous, next];
        return after.length > 2 ? after.slice(-2) : after;
      });
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <figure className="launch-side-art" aria-hidden="true">
      <div className="launch-art-frame">
        {stack.map((index, layer) => (
          <MouseArtLayer
            key={MOUSE_ART[index]}
            src={MOUSE_ART[index]}
            active={layer === stack.length - 1}
            onDone={() => setStack([stack[stack.length - 1] ?? 0])}
          />
        ))}
      </div>
    </figure>
  );
}

function LaunchStage({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="launch-stage">
      <MouseArtStage />

      <div className="launch-center">{children}</div>

      <figure className="launch-side-art" aria-hidden="true">
        <img
          className="launch-mascot"
          src={MASCOT_URL}
          alt=""
          width={400}
          height={400}
          loading="eager"
          draggable={false}
        />
      </figure>
    </div>
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
        <h1 className="launch-title">
          Early Access <em>launches</em> soon.
        </h1>
        <p className="launch-lead">
          OpenMouse is a free, open source mouse configurator. Configure DPI,
          polling rate, lighting, and more &mdash; without vendor software.
        </p>

        <div className="launch-timer" role="timer" aria-label="Time until launch">
          <DropDown value={remaining.days} label="Days" />
          <span className="launch-colon" aria-hidden="true">:</span>
          <DropDown value={remaining.hours} label="Hours" />
          <span className="launch-colon" aria-hidden="true">:</span>
          <DropDown value={remaining.minutes} label="Minutes" />
          <span className="launch-colon" aria-hidden="true">:</span>
          <DropDown value={remaining.seconds} label="Seconds" />
        </div>

        <p className="launch-warm">
          Thank you for your patience &mdash; we can&rsquo;t wait to see you
          there for Early Access.
        </p>
      </section>
    </LaunchStage>
  );
}
