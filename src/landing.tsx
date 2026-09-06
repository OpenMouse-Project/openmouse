import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./landing.css";
import { mountOfflineBanner } from "./offline-banner";
import { registerServiceWorker } from "./register-sw";
import { APP_URL, SiteFooter, SiteNav } from "./app/site-chrome";
import { t } from "./i18n";
import type { InterfaceLocale } from "./interface-preferences";
import { usePageLocale } from "./app/page-locale";

function Hero({ locale }: { locale: InterfaceLocale }): ReactNode {
  return (
    <section className="land-hero">
      <p className="land-eyebrow">{t(locale, "land.eyebrow")}</p>
      <h1>{t(locale, "land.hero")}</h1>
      <p className="land-lead">
        {t(locale, "land.lead")}
      </p>
      <div className="land-hero-actions">
        <a className="land-cta" href={APP_URL}>{t(locale, "land.openApp")}</a>
        <a className="land-cta-secondary" href="/supported.html">{t(locale, "land.checkMouse")}</a>
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

function Features({ locale }: { locale: InterfaceLocale }): ReactNode {
  return (
    <section className="land-features">
      <Feature
        title={t(locale, "land.f1t")}
        body={t(locale, "land.f1b")}
      />
      <Feature
        title={t(locale, "land.f2t")}
        body={t(locale, "land.f2b")}
      />
      <Feature
        title={t(locale, "land.f3t")}
        body={t(locale, "land.f3b")}
      />
    </section>
  );
}

function Contribute({ locale }: { locale: InterfaceLocale }): ReactNode {
  return (
    <section className="land-contribute">
      <h2>{t(locale, "land.contribTitle")}</h2>
      <p>
        {t(locale, "land.contribBody")}
      </p>
      <a className="land-cta-secondary" href="https://docs.openmouse.app">{t(locale, "land.contribCta")}</a>
    </section>
  );
}

function Landing(): ReactNode {
  const [locale, setLocale] = usePageLocale();
  return (
    <div className="land-shell">
      <SiteNav locale={locale} onLocale={setLocale} />
      <Hero locale={locale} />
      <Features locale={locale} />
      <Contribute locale={locale} />
      <SiteFooter locale={locale} />
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
