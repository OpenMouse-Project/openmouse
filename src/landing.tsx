import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./landing.css";
import { mountOfflineBanner } from "./offline-banner";
import { registerServiceWorker } from "./register-sw";
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
} from "./app/social-links";

// The control app lives on its own subdomain — dev.openmouse.app is
// retired, openmouse.app is this marketing page, control.openmouse.app is
// the actual configurator.
const APP_URL = "https://control.openmouse.app/";

function Nav(): ReactNode {
  return (
    <header className="land-nav">
      <a className="land-brand" href="/">
        <img src="/logo.png" alt="" width={22} height={32} />
        OpenMouse
      </a>
      <nav className="land-nav-links">
        <a href="/supported.html">Supported mice</a>
        <a href="https://docs.openmouse.app">Contribute</a>
        <a href="/donate.html">Donate</a>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
      </nav>
      <a className="land-nav-cta" href={APP_URL}>Open the app</a>
    </header>
  );
}

function Hero(): ReactNode {
  return (
    <section className="land-hero">
      <p className="land-eyebrow">Free &middot; Open source &middot; No vendor software</p>
      <h1>One app for every mouse.</h1>
      <p className="land-lead">
        OpenMouse runs entirely in your browser over WebHID — DPI, polling
        rate, buttons, and RGB, for dozens of gaming mice, with no accounts,
        no installs, and no telemetry sent anywhere.
      </p>
      <div className="land-hero-actions">
        <a className="land-cta" href={APP_URL}>Open the app</a>
        <a className="land-cta-secondary" href="/supported.html">Check your mouse</a>
      </div>
    </section>
  );
}

function Feature({ title, body }: { title: string; body: string }): ReactNode {
  return (
    <div className="land-feature">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function Features(): ReactNode {
  return (
    <section className="land-features">
      <Feature
        title="Runs in your browser"
        body="No installer, no background service, no account. Plug in your mouse, open the page, and it's there over WebHID."
      />
      <Feature
        title="Dozens of mice, one app"
        body="One consistent interface across brands and models, instead of a different bloated app per manufacturer."
      />
      <Feature
        title="Fully open source"
        body="Every driver is reverse-engineered in the open and reviewed on GitHub — nothing phones home, and you can read exactly what it does."
      />
    </section>
  );
}

function Contribute(): ReactNode {
  return (
    <section className="land-contribute">
      <h2>Help add support for more mice</h2>
      <p>
        OpenMouse only supports what the community has reverse-engineered and
        tested. If your mouse isn't listed yet, the contribution guide walks
        through safe reverse-engineering practices and how the driver repos
        fit together.
      </p>
      <a className="land-cta-secondary" href="https://docs.openmouse.app">Read the contribution guide</a>
    </section>
  );
}

function Footer(): ReactNode {
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

function Landing(): ReactNode {
  return (
    <div className="land-shell">
      <Nav />
      <Hero />
      <Features />
      <Contribute />
      <Footer />
    </div>
  );
}

const landingApp = document.querySelector<HTMLDivElement>("#landing-app");

if (!landingApp) {
  throw new Error("OpenMouse could not find the landing page root.");
}

createRoot(landingApp).render(<Landing />);

registerServiceWorker();
mountOfflineBanner();
