import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import { CONVENTIONAL_STEP, savedMs, stepTimes, type DepthSample } from "../hits-test";

const ROUNDS = 1;
// After the press, wait for the rest of its depth reports before comparing.
const SETTLE_MS = 300;

type Phase = "idle" | "wait" | "go" | "settle" | "done";
interface Round { reaction: number; saved: number | null; steps: (number | null)[] }

const ms = (value: number): string => `${Math.round(value)} ms`;
const signed = (value: number): string => `${value > 0 ? "+" : ""}${Math.round(value)} ms`;

/**
 * Click as fast as you can when the field turns blue. Each press is compared with
 * a conventional switch (which fires at step 5) using the press-depth stream the
 * HITS card already keeps armed.
 */
export function HitsTestDialog({
  open,
  locale,
  actuation,
  maxActuation,
  canAdjust,
  onAdjust,
  onClose,
}: {
  open: boolean;
  locale: InterfaceLocale;
  /** Actuation step of the left and right buttons. */
  actuation: [number, number];
  maxActuation: number;
  /** False while a change would only be staged, not yet on the mouse. */
  canAdjust: boolean;
  onAdjust: (side: 0 | 1, value: number) => void;
  onClose: () => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [side, setSide] = useState<0 | 1>(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [note, setNote] = useState("");
  const roundsRef = useRef<Round[]>([]);
  const samples = useRef<DepthSample[]>([]);
  const goAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const sideRef = useRef(side);
  sideRef.current = side;
  const actuationRef = useRef(actuation);
  actuationRef.current = actuation;

  const reset = (): void => {
    window.clearTimeout(timer.current);
    roundsRef.current = [];
    setRounds([]);
    setNote("");
    setPhase("idle");
  };

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) reset();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return control.subscribeAnalogPress((left, right) => {
      samples.current.push({ t: performance.now(), depth: sideRef.current === 0 ? left : right });
    });
  }, [open]);

  const start = (): void => {
    window.clearTimeout(timer.current);
    setNote("");
    setPhase("wait");
    timer.current = window.setTimeout(() => {
      goAt.current = performance.now();
      samples.current = [];
      setPhase("go");
    }, 1000 + Math.random() * 2000);
  };

  const press = (event: MouseEvent): void => {
    event.preventDefault();
    if (event.button !== (side === 0 ? 0 : 2)) return;
    if (phase === "idle" || phase === "done") {
      roundsRef.current = [];
      setRounds([]);
      start();
    } else if (phase === "wait") {
      window.clearTimeout(timer.current);
      setNote("Too early. Wait for blue.");
      setPhase("idle");
    } else if (phase === "go") {
      const reaction = event.timeStamp - goAt.current;
      setPhase("settle");
      timer.current = window.setTimeout(() => {
        const saved = savedMs(samples.current, actuationRef.current[sideRef.current]);
        roundsRef.current = [...roundsRef.current, { reaction, saved, steps: stepTimes(samples.current, goAt.current) }];
        setRounds(roundsRef.current);
        if (roundsRef.current.length >= ROUNDS) setPhase("done");
        else start();
      }, SETTLE_MS);
    }
  };

  const label = phase === "idle" ? (note || "Click here to start")
    : phase === "wait" ? "Wait for blue…"
      : phase === "go" ? "Click now!"
        : "…";
  const value = actuation[side];
  const last = rounds[rounds.length - 1];
  const at = (step: number): number | null => last?.steps[step - 1] ?? null;
  const hitsTime = at(value);
  const conventionalTime = at(CONVENTIONAL_STEP);

  return (
    <dialog
      ref={dialog}
      className="support-dialog share-profile-dialog hits-test-dialog"
      aria-labelledby="hits-test-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <div className="support-dialog-inner share-profile-dialog-inner hits-test">
        <header>
          <div>
            <p className="overline">HITS Tuning</p>
            <h2 id="hits-test-title">HITS speed test</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>
        <div className="hits-test-body">
          <div className="hits-test-side">
            <small className="setting-description">
              A normal mouse switch fires at one fixed point, about step 5 on the HITS scale. When the field turns blue,
              click as fast as you can. Each press is timed against that step, so you see how much sooner your
              actuation fires. Change the actuation and run it again to compare.
            </small>
            <label className="profile-key-field">
              <span>Button</span>
              <select
                value={side}
                onChange={(event) => {
                  setSide(Number(event.currentTarget.value) as 0 | 1);
                  reset();
                }}
              >
                <option value={0}>Left button</option>
                <option value={1}>Right button</option>
              </select>
            </label>
            <div className="hits-test-actuation">
              <span>Actuation point</span>
              <div>
                <button type="button" disabled={!canAdjust || value <= 1} onClick={() => onAdjust(side, value - 1)} aria-label="Lower actuation">-</button>
                <strong>{value}</strong>
                <button type="button" disabled={!canAdjust || value >= maxActuation} onClick={() => onAdjust(side, value + 1)} aria-label="Raise actuation">+</button>
              </div>
            </div>
            {!canAdjust ? <small className="setting-description">Turn on Instant flash to change the actuation here.</small> : null}
          </div>
          <button
            type="button"
            className={`hits-test-area is-${phase}`}
            onMouseDown={press}
            onContextMenu={(event) => event.preventDefault()}
          >
            {phase === "done" && last ? (
              <span className="hits-test-result">
                <span className="hits-test-result-numbers">
                  <small>Time saved</small>
                  <strong>{last.saved === null ? "-" : signed(last.saved)}</strong>
                  {last.saved !== null && last.saved <= 0 ? <em>Try a lower actuation to save time.</em> : null}
                  <small>Your HITS setting</small>
                  <b>{hitsTime === null ? "-" : ms(hitsTime)}</b>
                  <small>Conventional switch</small>
                  <b>{conventionalTime === null ? "-" : ms(conventionalTime)}</b>
                </span>
                <span className="hits-test-ladder" aria-label="Time to reach each step">
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((step) => (
                    <span key={step} data-mark={step === value ? "hits" : step === CONVENTIONAL_STEP ? "conventional" : undefined}>
                      <i>{step}</i>
                      <u>{at(step) === null ? "-" : ms(at(step) as number)}</u>
                    </span>
                  ))}
                </span>
                <small>Click again to start over.</small>
              </span>
            ) : label}
          </button>
        </div>
        <div className="import-hits-actions">
          <button type="button" className="connect-button" onClick={onClose}>{t(locale, "common.close")}</button>
        </div>
      </div>
    </dialog>
  );
}
