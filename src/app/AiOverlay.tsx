import { Bot, BotMessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import { DISCORD_URL } from "./social-links";

type TopicId = "connect" | "dpi" | "browser" | "saving" | "other";

const TOPIC_ORDER: TopicId[] = ["connect", "dpi", "browser", "saving", "other"];

interface Message {
  from: "bot" | "user";
  text: string;
}

export function AiOverlay({ locale = "en" }: { locale?: InterfaceLocale }): ReactNode {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typed, setTyped] = useState(true);
  const [greeted, setGreeted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!greeted) {
      setGreeted(true);
      scheduleAnswer(t(locale, "ai.greeting"), 700);
    }
  }, [open, greeted, locale]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, typed, open]);

  function scheduleAnswer(answer: string, delay: number): void {
    setTyped(false);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setMessages((current) => [...current, { from: "bot", text: answer }]);
      setTyped(true);
    }, delay);
  }

  const topicLabel = (id: TopicId): string => {
    switch (id) {
      case "connect": return t(locale, "ai.topic1");
      case "dpi": return t(locale, "ai.topic2");
      case "browser": return t(locale, "ai.topic3");
      case "saving": return t(locale, "ai.topic4");
      case "other": return t(locale, "ai.other");
    }
  };

  const topicAnswer = (id: TopicId): string => {
    switch (id) {
      case "connect": return t(locale, "ai.topic1Ans");
      case "dpi": return t(locale, "ai.topic2Ans");
      case "browser": return t(locale, "ai.topic3Ans");
      case "saving": return t(locale, "ai.topic4Ans");
      case "other": return t(locale, "ai.otherAns");
    }
  };

  function pick(id: TopicId): void {
    if (!typed) return;
    setMessages((current) => [...current, { from: "user", text: topicLabel(id) }]);
    const answer = topicAnswer(id);
    scheduleAnswer(answer, 450 + Math.min(answer.length * 6, 2200));
  }

  return (
    <>
      <button
        type="button"
        className={`ai-launcher${open ? " is-open" : ""}`}
        title={t(locale, "ai.title")}
        aria-label={t(locale, "ai.title")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <X size={20} strokeWidth={2} aria-hidden="true" />
        ) : (
          <BotMessageSquare size={20} strokeWidth={1.9} aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div className="ai-overlay" role="dialog" aria-label={t(locale, "ai.title")}>
          <header className="ai-head">
            <div className="ai-head-brand">
              <span className="ai-head-mark">
                <Bot size={18} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <div>
                <strong>{t(locale, "ai.title")}</strong>
                <span>{t(locale, "ai.subtitle")}</span>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label={t(locale, "common.close")}>×</button>
          </header>

          <div className="ai-scroll" ref={scrollRef}>
            {messages.map((message, index) => (
              <div key={index} className={`ai-message is-${message.from}`}>
                {message.text}
              </div>
            ))}
            {!typed ? (
              <div className="ai-message is-bot ai-typing" aria-hidden="true">
                <span className="ai-typing-dot" />
                <span className="ai-typing-dot" />
                <span className="ai-typing-dot" />
              </div>
            ) : null}
          </div>

          <div className="ai-options">
            {TOPIC_ORDER.map((id) => (
              <button key={id} type="button" disabled={!typed} onClick={() => pick(id)}>
                {topicLabel(id)}
              </button>
            ))}
          </div>

          <footer className="ai-foot">
            <a href={DISCORD_URL} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 126.644 96" aria-hidden="true">
                <path fill="currentColor" d="M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z" />
              </svg>
              {t(locale, "ai.joinDiscord")}
            </a>
          </footer>
        </div>
      ) : null}
    </>
  );
}