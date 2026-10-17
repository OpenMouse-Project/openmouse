import { ChevronDown, CircleHelp, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t, type I18nKey } from "../i18n/index";
import type { InterfaceLocale } from "../features/settings/interface-preferences";
import { DISCORD_URL, DiscordIcon } from "../shared/social-links";

const TOPICS: { question: I18nKey; answer: I18nKey }[] = [
  { question: "ai.topic1", answer: "ai.topic1Ans" },
  { question: "ai.topic2", answer: "ai.topic2Ans" },
  { question: "ai.topic3", answer: "ai.topic3Ans" },
  { question: "ai.topic4", answer: "ai.topic4Ans" },
];

const FAQ_URL = "https://openmouse.app/faq";

export function HelpPanel({ locale = "en" }: { locale?: InterfaceLocale }): ReactNode {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        launcher.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !launcher.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <>
      <button
        ref={launcher}
        type="button"
        className={`om-help-launcher${open ? " is-open" : ""}`}
        title={t(locale, "nav.help")}
        aria-label={t(locale, "nav.help")}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X strokeWidth={2} aria-hidden="true" /> : <CircleHelp strokeWidth={1.9} aria-hidden="true" />}
      </button>

      {open ? (
        <div ref={panel} id={id} className="om-help" role="dialog" aria-labelledby={`${id}-title`}>
          <header className="om-help-head">
            <strong id={`${id}-title`}>{t(locale, "nav.help")}</strong>
            <span>{t(locale, "ai.subtitle")}</span>
          </header>

          <ul className="om-help-list">
            {TOPICS.map((topic, index) => {
              const isOpen = expanded === index;
              return (
                <li key={topic.question} className={isOpen ? "is-open" : undefined}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`${id}-a${index}`}
                    onClick={() => setExpanded(isOpen ? null : index)}
                  >
                    <span>{t(locale, topic.question)}</span>
                    <ChevronDown strokeWidth={2} aria-hidden="true" />
                  </button>
                  <p id={`${id}-a${index}`} hidden={!isOpen}>{t(locale, topic.answer)}</p>
                </li>
              );
            })}
          </ul>

          <footer className="om-help-foot">
            <span>{t(locale, "ai.other")}</span>
            <div className="om-help-links">
              <a className="om-btn" href={FAQ_URL} target="_blank" rel="noreferrer">
                {t(locale, "help.faq")}
                <ExternalLink strokeWidth={2} aria-hidden="true" />
              </a>
              <a className="om-btn om-help-discord" href={DISCORD_URL} target="_blank" rel="noreferrer">
                <DiscordIcon />
                {t(locale, "ai.joinDiscord")}
              </a>
            </div>
          </footer>
        </div>
      ) : null}
    </>
  );
}
