import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
// FAQ shares landing.css so the header/footer render identically to the
// landing page — see src/app/site-chrome.tsx for the shared components.
import "./landing.css";
import { mountOfflineBanner } from "./offline-banner";
import { registerServiceWorker } from "./register-sw";
import { SiteFooter, SiteNav } from "./app/site-chrome";
import { DISCORD_URL, GITHUB_URL } from "./app/social-links";

interface FaqEntry {
  question: string;
  answer: ReactNode;
}

const FAQS: FaqEntry[] = [
  {
    question: "Is OpenMouse free?",
    answer:
      "Yes. OpenMouse is free and open source, with no accounts, subscriptions, or paid tiers.",
  },
  {
    question: "Does OpenMouse send any of my data anywhere?",
    answer:
      "No. OpenMouse runs entirely in your browser over WebHID — there's no telemetry, no background service, and nothing phones home. You can read exactly what it does, since every driver is open source.",
  },
  {
    question: "Which mice are supported?",
    answer: (
      <>
        Dozens of gaming mice across several brands. Check the{" "}
        <a href="/supported.html">supported mice list</a> for the current
        set — support depends on what the community has reverse-engineered
        and tested so far.
      </>
    ),
  },
  {
    question: "What browsers work with OpenMouse?",
    answer:
      "OpenMouse needs a browser with WebHID support, so Chrome, Edge, and other Chromium-based browsers work. Firefox and Safari don't currently support WebHID.",
  },
  {
    question: "My mouse isn't listed — can I add support for it?",
    answer: (
      <>
        Yes. The{" "}
        <a href="https://docs.openmouse.app">contribution guide</a> walks
        through safe reverse-engineering practices and how the driver repos
        fit together.
      </>
    ),
  },
  {
    question: "Do I need to install anything?",
    answer:
      "No installer, no driver, no background app. Plug in your mouse, open the page in a supported browser, and it's there.",
  },
  {
    question: "Is my configuration stored anywhere?",
    answer:
      "Your settings are only stored locally, in your browser — there's no account and no cloud sync.",
  },
  {
    question: "How can I support the project?",
    answer: (
      <>
        Star the project on <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>,
        join the <a href={DISCORD_URL} target="_blank" rel="noreferrer">Discord</a>, or{" "}
        <a href="/donate.html">donate</a> to help fund testing hardware and
        development.
      </>
    ),
  },
];

function Faq(): ReactNode {
  return (
    <section className="land-faq">
      <h1>Frequently asked questions</h1>
      <dl className="land-faq-list">
        {FAQS.map(({ question, answer }) => (
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
  return (
    <div className="land-shell">
      <SiteNav />
      <Faq />
      <SiteFooter />
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
