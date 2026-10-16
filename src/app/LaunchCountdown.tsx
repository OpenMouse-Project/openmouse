import { displayText } from "../i18n";
import { useUiLocale } from "./ui-locale";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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

function LaunchSocials(): ReactNode {
  const __uiLocale = useUiLocale();
  const stars = useGitHubStars();

  return (
    <footer className="launch-socials">
      <a href={DISCORD_URL} target="_blank" rel="noreferrer" title={displayText(__uiLocale, "Discord")} aria-label={displayText(__uiLocale, "OpenMouse on Discord")}>
        <DiscordIcon />
      </a>
      <a href={TWITTER_URL} target="_blank" rel="noreferrer" title={displayText(__uiLocale, "Twitter")} aria-label={displayText(__uiLocale, "OpenMouse on Twitter")}>
        <TwitterIcon />
      </a>
      <a
        className="launch-social-stars"
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        title={displayText(__uiLocale, "GitHub")}
        aria-label={displayText(__uiLocale, "OpenMouse on GitHub")}
      >
        <GitHubIcon />
        {stars !== null && (
          <span className="launch-star-count">
            <StarIcon />
            {displayText(__uiLocale, formatCount(stars))}
          </span>
        )}
      </a>
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
  const __uiLocale = useUiLocale();
  return (
    <div className="launch-digit" aria-label={displayText(__uiLocale, `${value} ${label}`)}>
      <span className="launch-digit-value" aria-hidden="true">{displayText(__uiLocale, pad(value))}</span>
      <span className="launch-digit-label">{displayText(__uiLocale, label)}</span>
    </div>
  );
}

function LaunchStage({ children }: { children: ReactNode }): ReactNode {
  const __uiLocale = useUiLocale();
  return (
    <>
      <div className="launch-stage">
        <div className="launch-brand">
          <img src="/logo.png" alt={displayText(__uiLocale, "")} width={28} height={41} />
          OpenMouse
        </div>
        {children}
      </div>
      <LaunchSocials />
    </>
  );
}

export function LaunchCountdown(): ReactNode {
  const __uiLocale = useUiLocale();
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
          <h1 className="launch-title">{displayText(__uiLocale, "Early Access is live.")}</h1>
          <p className="launch-lead"> {displayText(__uiLocale, "OpenMouse Beta 1.0 is now available. Configure your mouse and get started.")} </p>
          <a className="launch-cta" href="/">{displayText(__uiLocale, "Enter the app")}</a>
        </section>
      </LaunchStage>
    );
  }

  return (
    <LaunchStage>
      <section className="launch-hero" aria-live="polite">
        <h1 className="launch-title">{displayText(__uiLocale, "Early Access launches soon.")}</h1>

        <div className="launch-timer" role="timer" aria-label={displayText(__uiLocale, "Time until launch")}>
          <Digit value={remaining.days} label={displayText(__uiLocale, "Days")} />
          <span className="launch-colon" aria-hidden="true">:</span>
          <Digit value={remaining.hours} label={displayText(__uiLocale, "Hours")} />
          <span className="launch-colon" aria-hidden="true">:</span>
          <Digit value={remaining.minutes} label={displayText(__uiLocale, "Minutes")} />
          <span className="launch-colon" aria-hidden="true">:</span>
          <Digit value={remaining.seconds} label={displayText(__uiLocale, "Seconds")} />
        </div>

        <p className="launch-lead"> {displayText(__uiLocale, "A free, open source mouse configurator — no vendor software.")} </p>
      </section>
    </LaunchStage>
  );
}
