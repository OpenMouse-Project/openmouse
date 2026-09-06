import type { ReactNode } from "react";
import {
  DiscordIcon,
  DISCORD_URL,
  formatCount,
  GitHubIcon,
  GITHUB_URL,
  StarIcon,
  TwitterIcon,
  TWITTER_URL,
  useGitHubStars,
} from "./social-links";

// The control app lives on its own subdomain — dev.openmouse.app is
// retired, openmouse.app is this marketing page, control.openmouse.app is
// the actual configurator.
export const APP_URL = "https://control.openmouse.app/";

// Shared header/footer for the marketing pages (openmouse.app) — landing.tsx
// and faq.tsx both render these so the two pages look coherent.
export function SiteNav(): ReactNode {
  return (
    <header className="land-nav">
      <a className="land-brand" href="/">
        <img src="/logo.png" alt="" width={22} height={32} />
        OpenMouse
      </a>
      <nav className="land-nav-links">
        <a href="/supported.html">Supported mice</a>
        <a href="/faq.html">FAQ</a>
        <a href="https://docs.openmouse.app">Contribute</a>
        <a href="/donate.html">Donate</a>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
      </nav>
      <a className="land-nav-cta" href={APP_URL}>Open the app</a>
    </header>
  );
}

export function SiteFooter(): ReactNode {
  const stars = useGitHubStars();

  return (
    <footer className="land-footer">
      <a href={DISCORD_URL} target="_blank" rel="noreferrer" title="Discord" aria-label="OpenMouse on Discord">
        <DiscordIcon />
      </a>
      <a href={TWITTER_URL} target="_blank" rel="noreferrer" title="Twitter" aria-label="OpenMouse on Twitter">
        <TwitterIcon />
      </a>
      <a
        className="land-footer-stars"
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        title="GitHub"
        aria-label="OpenMouse on GitHub"
      >
        <GitHubIcon />
        {stars !== null && (
          <span className="land-star-count">
            <StarIcon />
            {formatCount(stars)}
          </span>
        )}
      </a>
      <a href="/donate.html">Donate</a>
    </footer>
  );
}
