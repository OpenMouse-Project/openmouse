import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
// FAQ shares landing.css so the header/footer render identically to the
// landing page — see src/app/site-chrome.tsx for the shared components.
import "./landing.css";
import { mountOfflineBanner } from "./offline-banner";
import { registerServiceWorker } from "./register-sw";
import { SiteFooter, SiteNav } from "./app/site-chrome";
import { DISCORD_URL, GITHUB_URL } from "./app/social-links";
import { t } from "./i18n";
import type { InterfaceLocale } from "./interface-preferences";
import { usePageLocale } from "./app/page-locale";

interface FaqEntry {
  question: string;
  answer: ReactNode;
}

function faqs(locale: InterfaceLocale): FaqEntry[] {
  return [
    { question: t(locale, "faq.q1"), answer: t(locale, "faq.a1") },
    { question: t(locale, "faq.q2"), answer: t(locale, "faq.a2") },
    {
      question: t(locale, "faq.q3"),
      answer: (
        <>
          {t(locale, "faq.a3a")}{" "}
          <a href="/supported.html">{t(locale, "faq.a3b")}</a> {t(locale, "faq.a3c")}
        </>
      ),
    },
    { question: t(locale, "faq.q4"), answer: t(locale, "faq.a4") },
    {
      question: t(locale, "faq.q5"),
      answer: (
        <>
          {t(locale, "faq.a5a")}{" "}
          <a href="https://docs.openmouse.app">{t(locale, "faq.a5b")}</a>{" "}
          {t(locale, "faq.a5c")}
        </>
      ),
    },
    { question: t(locale, "faq.q6"), answer: t(locale, "faq.a6") },
    { question: t(locale, "faq.q7"), answer: t(locale, "faq.a7") },
    {
      question: t(locale, "faq.q8"),
      answer: (
        <>
          {t(locale, "faq.a8a")} <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>,
          {" "}{t(locale, "faq.a8b")} <a href={DISCORD_URL} target="_blank" rel="noreferrer">Discord</a>,{" "}
          <a href="/donate.html">{t(locale, "land.donate")}</a> {t(locale, "faq.a8c")}
        </>
      ),
    },
  ];
}

function Faq({ locale }: { locale: InterfaceLocale }): ReactNode {
  return (
    <section className="land-faq">
      <h1>{t(locale, "faq.title")}</h1>
      <dl className="land-faq-list">
        {faqs(locale).map(({ question, answer }) => (
          <div className="land-faq-item" key={question}>
            <dt>{question}</dt>
            <dd>{answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FaqPage(): ReactNode {
  const [locale, setLocale] = usePageLocale();
  return (
    <div className="land-shell">
      <SiteNav locale={locale} onLocale={setLocale} />
      <Faq locale={locale} />
      <SiteFooter locale={locale} />
    </div>
  );
}

const faqApp = document.querySelector<HTMLDivElement>("#faq-app");

if (!faqApp) {
  throw new Error("OpenMouse could not find the FAQ page root.");
}

createRoot(faqApp).render(<FaqPage />);

registerServiceWorker();
mountOfflineBanner();
