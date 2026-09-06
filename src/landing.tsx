import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./landing.css";
import { mountOfflineBanner } from "./offline-banner";
import { registerServiceWorker } from "./register-sw";
import { APP_URL, SiteFooter, SiteNav } from "./app/site-chrome";

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

function Landing(): ReactNode {
  return (
    <div className="land-shell">
      <SiteNav />
      <Hero />
      <Features />
      <Contribute />
      <SiteFooter />
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
