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
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import { PageLocaleToggle } from "./page-locale";

// The control app lives on its own subdomain — dev.openmouse.app is
// retired, openmouse.app is this marketing page, control.openmouse.app is
// the actual configurator.
export const APP_URL = "https://control.openmouse.app/";

// Shared header/footer for the marketing pages (openmouse.app) — landing.tsx
// and faq.tsx both render these so the two pages look coherent.
export function SiteNav({ locale, onLocale }: { locale: InterfaceLocale; onLocale: (next: InterfaceLocale) => void }): ReactNode {
  return (
    <header className="land-nav">
      <a className="land-brand" href="/">
        <img src="/logo.png" alt="" width={22} height={32} />
        OpenMouse
      </a>
      <nav className="land-nav-links">
        <a href="/supported.html">{t(locale, "land.supported")}</a>
        <a href="/faq.html">FAQ</a>
        <a href="https://docs.openmouse.app">{t(locale, "land.contribute")}</a>
        <a href="/donate.html">{t(locale, "land.donate")}</a>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
      </nav>
      <PageLocaleToggle locale={locale} onChange={onLocale} />
      <a className="land-nav-cta" href={APP_URL}>{t(locale, "land.openApp")}</a>
    </header>
  );
}

export function SiteFooter({ locale }: { locale: InterfaceLocale }): ReactNode {
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
      <a href="/donate.html">{t(locale, "land.donate")}</a>
    </footer>
  );
}
