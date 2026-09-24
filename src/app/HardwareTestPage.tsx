import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { t, tp } from "../i18n";
import { computeResults, formatHz, rollingLiveHz } from "../ui/polling-stats";
import { brandChecks } from "../hardware-brand-checks";
import {
  automaticChecks,
  buildDiscordEmbed,
  deviceInfoFromSnapshot,
  flashWriteResult,
  formatHexId,
  pickFlashDpiTarget,
  pickFlashLiftOffTarget,
  pickFlashPollRateTarget,
  pollingSampleResult,
  verdictFor,
  type FlashSettingRoundTrip,
  type HardwareTestReport,
  type HardwareTestResult,
} from "../hardware-test-report";
import { crosscheckSupportedDevices } from "../supported-devices-crosscheck";
import { DeviceShowcaseSidebar } from "./OverviewPage";

/**
 * One animated row in the run panel. The suite surfaces itself as a sequence
 * of stages — "Test started", each check animating in with a spinner while it
 * runs, plus dedicated sampling (determinate progress bar with a live Hz
 * readout) and flash (indeterminate "writing" wave) stages — never a terminal
 * log.
 */
type StageKind = "start" | "check" | "sampling" | "flash";
type StageState = "running" | "pass" | "fail" | "skip";

interface TestStage {
  id: number;
  kind: StageKind;
  /** Human label of the stage; check labels come from the report module. */
  label: string;
  state: StageState;
  detail?: string | null;
  /** Interactive callout shown only while the stage is running. */
  hint?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Summarizes the HID collections the browser exposes for the connected device
 * (usage page:usage per top-level collection) — the descriptor-level half of
 * the control-interface check. Returns null on bridge-only transports or when
 * the device is not visible to WebHID.
 */
async function hidInterfacesSummary(vendorId: number | null, productId: number | null): Promise<string | null> {
  if (vendorId === null || productId === null) return null;
  try {
    if (typeof navigator === "undefined" || !("hid" in navigator)) return null;
    const devices = (await navigator.hid?.getDevices()) ?? [];
    const matches = devices.filter((device) => device.vendorId === vendorId && device.productId === productId);
    if (matches.length === 0) return null;
    const names = matches.flatMap((device) =>
      device.collections.map((collection) => `${formatHexId(collection.usagePage)}:${formatHexId(collection.usage)}`),
    );
    if (names.length === 0) return null;
    return `interfaces ${[...new Set(names)].join(", ")}`;
  } catch {
    return null;
  }
}

const SAMPLE_WINDOW_MS = 5000;

export function HardwareTestPage({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;

  const [stages, setStages] = useState<TestStage[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<HardwareTestReport | null>(null);
  const [sharing, setSharing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  /** Live readout during the sampling stage. */
  const [liveSample, setLiveSample] = useState<{ hz: string; samples: number } | null>(null);
  /** Elapsed sampling time, driving the determinate progress bar. 0 → SAMPLE_WINDOW_MS. */
  const [samplingElapsedMs, setSamplingElapsedMs] = useState(0);

  const runningRef = useRef(false);
  const cancelRef = useRef(false);
  const stageIdRef = useRef(0);

  const addStage = useCallback((stage: { kind: StageKind; label: string; state?: StageState; hint?: string }): number => {
    const id = stageIdRef.current++;
    setStages((prev) => [...prev, { id, state: "running", ...stage }]);
    return id;
  }, []);

  const updateStage = useCallback(
    (id: number, patch: { state: StageState; detail?: string | null }): void => {
      setStages((prev) => prev.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)));
    },
    [],
  );

  const endTest = useCallback(() => {
    if (!runningRef.current) return;
    cancelRef.current = true;
  }, []);

  const startTest = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    setRunning(true);
    setReport(null);
    setStages([]);
    setLiveSample(null);
    setSamplingElapsedMs(0);

    void (async () => {
      let info = deviceInfoFromSnapshot(snapshot);
      const results: HardwareTestResult[] = [];
      let aborted = false;
      const startedAt = performance.now();

      // Background descriptor lookup (feed the control-interface check detail)
      // — no stage of its own, it is not user-visible work.
      const interfaces = await hidInterfacesSummary(info.vendorId, info.productId);
      if (interfaces) info = { ...info, collectionsSummary: interfaces };

      // "Test started" — the opening beat of the run.
      const startedStage = addStage({ kind: "start", label: t(locale, "hw.testStarted") });
      await sleep(340);
      updateStage(startedStage, { state: "pass" });
      await sleep(140);

      const runCheckStage = async (check: HardwareTestResult): Promise<void> => {
        if (cancelRef.current) {
          aborted = true;
          results.push({ ...check, status: "skip" as const, detail: null });
          return;
        }
        const id = addStage({ kind: "check", label: check.label });
        await sleep(300);
        if (cancelRef.current) {
          aborted = true;
          updateStage(id, { state: "skip", detail: "stopped by user" });
          results.push({ ...check, status: "skip" as const, detail: null });
          return;
        }
        results.push(check);
        updateStage(id, { state: check.status, detail: check.detail });
        await sleep(130);
      };

      // ── Automatic (driver read-back) checks ────────────────────────────
      for (const check of automaticChecks(info)) {
        await runCheckStage(check);
      }

      // ── Brand-specific checks (docs/*-testing.md checklists) ───────────
      for (const check of brandChecks(info)) {
        await runCheckStage(check);
      }

      // ── Interactive checks ─────────────────────────────────────────────
      if (info.present && !aborted) {
        // Polling-rate sampling: move the mouse over the window. The stage
        // shows a determinate 5s progress bar plus a live Hz readout while
        // the user moves the mouse in small circles.
        const samplingId = addStage({
          kind: "sampling",
          label: pollingSampleResult({ events: 0, avgHz: 0, peakHz: 0, stability: 0, reportedHz: info.pollingRateHz }).label,
          hint: t(locale, "hw.samplingPrompt"),
        });
        await sleep(320);
        const intervals: number[] = [];
        let lastT = 0;
        const onMove = (event: PointerEvent): void => {
          const subs = typeof event.getCoalescedEvents === "function" && event.getCoalescedEvents().length > 0
            ? event.getCoalescedEvents()
            : [event];
          for (const ev of subs) {
            if (lastT > 0) {
              const delta = ev.timeStamp - lastT;
              if (delta >= 0.05 && delta <= 1000) intervals.push(delta);
            }
            lastT = ev.timeStamp;
          }
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        const samplingStart = performance.now();
        const progressTimer = window.setInterval(() => {
          setSamplingElapsedMs(Math.min(SAMPLE_WINDOW_MS, performance.now() - samplingStart));
        }, 120);
        const liveTimer = window.setInterval(() => {
          const live = rollingLiveHz(intervals);
          if (live > 0) setLiveSample({ hz: formatHz(live), samples: intervals.length });
        }, 250);
        for (let waited = 0; waited < SAMPLE_WINDOW_MS && !cancelRef.current; waited += 100) await sleep(100);
        window.clearInterval(progressTimer);
        window.clearInterval(liveTimer);
        window.removeEventListener("pointermove", onMove);

        let samplingResult: HardwareTestResult;
        if (cancelRef.current) {
          aborted = true;
          samplingResult = { key: "sampling", label: "Polling rate sampling", status: "skip", detail: "stopped by user" };
        } else {
          const computed = computeResults(intervals, SAMPLE_WINDOW_MS);
          samplingResult = pollingSampleResult({
            events: computed.events,
            avgHz: computed.avgHz,
            peakHz: computed.peakHz,
            stability: computed.stability,
            reportedHz: info.pollingRateHz,
          });
        }
        results.push(samplingResult);
        updateStage(samplingId, { state: samplingResult.status, detail: samplingResult.detail });
        await sleep(160);
      }

      // ── Flash write round-trip (write → read-back → restore) ───────────
      if (info.present && !aborted) {
        // The stage animates as an indeterminate "writing" wave whose length
        // varies with how many settings are writable on the device.
        const flashId = addStage({
          kind: "flash",
          label: flashWriteResult({ roundTrips: [] }).label,
          hint: t(locale, "hw.flashPrompt"),
        });
        await sleep(320);

        const runFlashLeg = async (leg: {
          setting: string;
          current: string;
          target: string;
          note: string;
          currentRaw: unknown;
          targetRaw: unknown;
          stageTarget: () => boolean;
          stageRestore: () => boolean;
          read: () => unknown;
        }): Promise<FlashSettingRoundTrip> => {
          await sleep(400);
          if (cancelRef.current) {
            aborted = true;
            return { setting: leg.setting, current: leg.current, target: leg.target, status: "skip", detail: "stopped by user." };
          }
          if (!leg.stageTarget()) {
            return { setting: leg.setting, current: leg.current, target: leg.target, status: "fail", detail: "the write was rejected by the driver." };
          }
          let written = false;
          try {
            await control.flashPendingChanges();
            written = true;
          } catch {
            written = false;
          }
          if (!written) {
            return { setting: leg.setting, current: leg.current, target: leg.target, status: "fail", detail: "the flash write was not executed." };
          }
          if (leg.read() !== leg.targetRaw) {
            return { setting: leg.setting, current: leg.current, target: leg.target, status: "fail", detail: `wrote ${leg.target} but read back something else — the write did not stick.` };
          }
          try {
            leg.stageRestore();
            await control.flashPendingChanges();
            if (leg.read() !== leg.currentRaw) {
              return { setting: leg.setting, current: leg.current, target: leg.target, status: "fail", detail: `restore to ${leg.current} failed after reading back ${leg.target} — device settings may have changed.` };
            }
          } catch {
            return { setting: leg.setting, current: leg.current, target: leg.target, status: "fail", detail: `restore to ${leg.current} failed after reading back ${leg.target} — device settings may have changed.` };
          }
          return { setting: leg.setting, current: leg.current, target: leg.target, status: "pass", detail: `wrote ${leg.target} → read back → restored ${leg.current}` };
        };

        let flashResult: HardwareTestResult;
        if (cancelRef.current) {
          aborted = true;
          flashResult = flashWriteResult({ skipped: true, skippedReason: "stopped by user." });
        } else {
          const live = control.getSnapshot();
          if (!live.status) {
            flashResult = flashWriteResult({ skipped: true, skippedReason: "no live device status — cannot round-trip a write." });
          } else if (live.settingsPending) {
            flashResult = flashWriteResult({ skipped: true, skippedReason: "you have staged, unapplied changes — apply or revert them first." });
          } else {
            const legs: FlashSettingRoundTrip[] = [];

            // Setting 1: DPI — round-trip (write → read-back → restore).
            const dpiCurrent = live.status.dpi;
            if (dpiCurrent === null) {
              legs.push({ setting: "DPI", current: "—", target: "—", status: "skip", detail: "no DPI value is reported on this device." });
            } else {
              const dpiTarget = pickFlashDpiTarget(dpiCurrent, live.dpiOptions);
              if (dpiTarget === null) {
                legs.push({ setting: "DPI", current: `${dpiCurrent.toLocaleString()} DPI`, target: "—", status: "skip", detail: "no alternate DPI value is writable on this device." });
              } else {
                legs.push(await runFlashLeg({
                  setting: "DPI",
                  current: `${dpiCurrent.toLocaleString()} DPI`,
                  target: `${dpiTarget.toLocaleString()} DPI`,
                  note: "your pointer speed changes briefly",
                  currentRaw: dpiCurrent,
                  targetRaw: dpiTarget,
                  stageTarget: () => control.applyDpiValue(dpiTarget),
                  stageRestore: () => control.applyDpiValue(dpiCurrent),
                  read: () => control.getSnapshot().status?.dpi ?? null,
                }));
              }
            }

            // Setting 2: Polling rate — round-trip.
            const rateCurrent = live.status.pollingRateHz;
            if (rateCurrent === null) {
              legs.push({ setting: "Poll rate", current: "—", target: "—", status: "skip", detail: "no polling rate is reported on this device." });
            } else {
              const rateTarget = pickFlashPollRateTarget(rateCurrent, live.status.supportedPollingRates ?? control.RATE_STEPS_HZ);
              if (rateTarget === null) {
                legs.push({ setting: "Poll rate", current: `${rateCurrent.toLocaleString()} Hz`, target: "—", status: "skip", detail: "no alternate polling rate is writable on this device." });
              } else {
                legs.push(await runFlashLeg({
                  setting: "Poll rate",
                  current: `${rateCurrent.toLocaleString()} Hz`,
                  target: `${rateTarget.toLocaleString()} Hz`,
                  note: "the reporting rate changes briefly",
                  currentRaw: rateCurrent,
                  targetRaw: rateTarget,
                  stageTarget: () => { control.applyPollingRate(rateTarget); return true; },
                  stageRestore: () => { control.applyPollingRate(rateCurrent); return true; },
                  read: () => control.getSnapshot().status?.pollingRateHz ?? null,
                }));
              }
            }

            // Setting 3: Lift-off distance — round-trip.
            const lodCurrent = live.status.liftOffDistance;
            if (lodCurrent === null) {
              legs.push({ setting: "Lift-off", current: "—", target: "—", status: "skip", detail: "no lift-off distance is reported on this device." });
            } else {
              const lodTarget = pickFlashLiftOffTarget(lodCurrent);
              if (lodTarget === null) {
                legs.push({ setting: "Lift-off", current: lodCurrent, target: "—", status: "skip", detail: "no alternate lift-off distance is available." });
              } else {
                legs.push(await runFlashLeg({
                  setting: "Lift-off",
                  current: lodCurrent,
                  target: lodTarget,
                  note: "the sensor lift height changes briefly",
                  currentRaw: lodCurrent,
                  targetRaw: lodTarget,
                  stageTarget: () => { control.applyLiftOffDistance(lodTarget); return true; },
                  stageRestore: () => { control.applyLiftOffDistance(lodCurrent); return true; },
                  read: () => control.getSnapshot().status?.liftOffDistance ?? null,
                }));
              }
            }

            flashResult = flashWriteResult({ roundTrips: legs });
          }
        }
        results.push(flashResult);
        updateStage(flashId, { state: flashResult.status, detail: flashResult.detail });
        await sleep(160);
      }

      // ── Summary ────────────────────────────────────────────────────────
      const verdict = verdictFor({ results, incomplete: aborted });

      // Crosscheck the device against the supported-devices page (the mirrored
      // table behind openmouse.app/supported): is it listed, and does this run
      // qualify it to move to "Supported"? Replaces pinging a maintainer: the
      // report now carries the page-side answer itself.
      setReport({
        device: info,
        results,
        verdict,
        durationMs: performance.now() - startedAt,
        runAt: new Date().toISOString(),
        build: snapshot.buildLabel,
        supportedPage: crosscheckSupportedDevices(info, verdict),
      });
    })().catch(() => {
      addStage({ kind: "check", label: "The suite crashed — restart the test", state: "fail" });
      setReport(null);
    }).finally(() => {
      runningRef.current = false;
      setRunning(false);
    });
  }, [snapshot, locale, addStage, updateStage]);

  const shareReport = useCallback(() => {
    if (!report || sharing || running) return;
    setSharing(true);
    void (async () => {
      try {
        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [buildDiscordEmbed(report)],
          }),
        });
        if (!response.ok) {
          let message: string | null = null;
          try {
            const body = (await response.json()) as { message?: unknown };
            if (typeof body?.message === "string") message = body.message;
          } catch {
            message = null;
          }
          // Surface the relay's own reason when it answered (e.g. "Feedback is
          // not configured." or "Discord rejected the feedback.") instead of a
          // generic "unreachable" toast that hides whether this is a config,
          // delivery, or network problem.
          control.pushToast("error", t(locale, "hw.reportError"), message ?? t(locale, "hw.reportErrorDetail"));
          return;
        }
        control.pushToast("success", t(locale, "hw.reportSent"), t(locale, "hw.reportSentDetail"));
      } catch {
        control.pushToast("error", t(locale, "hw.reportError"), t(locale, "hw.reportErrorDetail"));
      } finally {
        setSharing(false);
      }
    })();
  }, [report, sharing, running, locale]);

  // Opens the WebHID/Bridge device picker and connects the chosen mouse.
  // Outcomes surface through the device card and the controller's own toast.
  const connectDevice = useCallback(() => {
    if (connecting || running) return;
    setConnecting(true);
    void control
      .connect()
      .catch(() => undefined) // control.connect() handles failures internally; guard against rethrows.
      .finally(() => setConnecting(false));
  }, [connecting, running]);

  const baseInfo = deviceInfoFromSnapshot(snapshot);
  const [interfaceSummary, setInterfaceSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!baseInfo.present) {
      setInterfaceSummary(null);
      return;
    }
    let cancelled = false;
    void hidInterfacesSummary(baseInfo.vendorId, baseInfo.productId).then((summary) => {
      if (!cancelled) setInterfaceSummary(summary);
    });
    return () => {
      cancelled = true;
    };
  }, [baseInfo.present, baseInfo.vendorId, baseInfo.productId]);

  const info = baseInfo.present ? { ...baseInfo, collectionsSummary: interfaceSummary } : baseInfo;
  const passed = report?.results.filter((result) => result.status === "pass").length ?? 0;
  const failed = report?.results.filter((result) => result.status === "fail").length ?? 0;
  const skipped = report?.results.filter((result) => result.status === "skip").length ?? 0;
  const verdictLabel = report
    ? report.verdict === "pass"
      ? t(locale, "hw.verdictPass")
      : report.verdict === "fail"
        ? t(locale, "hw.verdictFail")
        : t(locale, "hw.verdictIncomplete")
    : null;

  const stateClass = running
    ? "running"
    : report
      ? report.verdict === "pass"
        ? "done"
        : report.verdict === "fail"
          ? "failed"
          : "stopped"
      : "idle";
  const stateText = running
    ? t(locale, "hw.stateRunning")
    : report
      ? report.verdict === "pass"
        ? t(locale, "hw.stateDone")
        : report.verdict === "fail"
          ? t(locale, "hw.stateFailed")
          : t(locale, "hw.stateStopped")
      : t(locale, "hw.stateIdle");

  const samplingPercent = Math.round((samplingElapsedMs / SAMPLE_WINDOW_MS) * 100);

  return (
    <div className="mouse-test-page hardware-test-page">
      <div className="mouse-test-header">
        <h1 className="mouse-test-title">{t(locale, "hw.title")}</h1>
        <p className="mouse-test-subtitle">{t(locale, "hw.subtitle")}</p>
      </div>

      <div className="hardware-test-layout">
        {/* ── Left: device showcase — the same card as the Overview
             performance tab ─────────────────────────────────────────── */}
        <aside className={`hardware-test-device${info.present ? " has-device" : ""}`}>
          {info.present ? (
            <DeviceShowcaseSidebar snapshot={snapshot} />
          ) : (
            <div className="hardware-test-no-device">
              <p className="hardware-test-no-device-title">{t(locale, "hw.noDevice")}</p>
              <p className="hardware-test-no-device-detail">{t(locale, "hw.noDeviceDetail")}</p>
              <button
                className="hardware-test-btn hardware-test-btn-connect"
                type="button"
                disabled={connecting || snapshot.connectDisabled}
                onClick={connectDevice}
              >
                {connecting ? "…" : t(locale, "hw.connect")}
              </button>
            </div>
          )}
        </aside>

        {/* ── Right: split panel — animated test run | live device status ── */}
        <section className="hardware-test-panel-wrap">
          <div className="hardware-test-panel" aria-label={t(locale, "hw.panelTitle")}>
            <div className="hardware-test-panel-head">
              <svg className="hardware-test-head-glyph" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 2 4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3zm-2 15-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"
                />
              </svg>
              <span className="hardware-test-panel-title">{t(locale, "hw.panelTitle")}</span>
              <span className={`hardware-test-state-pill ${stateClass}`}>
                <i aria-hidden="true" />
                {stateText}
              </span>
            </div>

            <div className="hardware-test-stages">
              {stages.length === 0 ? (
                <div className="hardware-test-ready">
                  <svg className="hardware-test-ready-glyph" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93zM4 15c0 4.42 3.58 8 8 8s8-3.58 8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z"
                    />
                  </svg>
                  <p>{t(locale, "hw.ready")}</p>
                </div>
              ) : null}

              {stages.map((stage) => (
                <div key={stage.id} className={`hardware-test-stage ${stage.state}`}>
                  <span className="hardware-test-stage-icon" aria-hidden="true">
                    {stage.state === "running" ? (
                      <i className="hardware-test-stage-spin" />
                    ) : stage.state === "pass" ? (
                      <svg viewBox="0 0 24 24">
                        <path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    ) : stage.state === "fail" ? (
                      <svg viewBox="0 0 24 24">
                        <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    ) : (
                      <i className="hardware-test-stage-skip" />
                    )}
                  </span>

                  <div className="hardware-test-stage-main">
                    <span className="hardware-test-stage-label">
                      {stage.state === "running" && stage.kind === "check"
                        ? tp(locale, "hw.checking", { label: stage.label })
                        : stage.label}
                    </span>
                    {stage.state === "running" && stage.hint ? (
                      <span className="hardware-test-stage-hint">{stage.hint}</span>
                    ) : null}
                    {stage.state !== "running" && stage.detail ? (
                      <span className="hardware-test-stage-detail">{stage.detail}</span>
                    ) : null}
                    {stage.kind === "sampling" && stage.state === "running" ? (
                      <div className="hardware-test-progress">
                        <i style={{ width: `${samplingPercent}%` }} />
                      </div>
                    ) : null}
                    {stage.kind === "flash" && stage.state === "running" ? (
                      <div className="hardware-test-progress hardware-test-progress-wave" aria-hidden="true" />
                    ) : null}
                  </div>

                  {stage.kind === "sampling" && stage.state === "running" ? (
                    <span className={`hardware-test-live${liveSample ? "" : " empty"}`} aria-live="polite">
                      {liveSample
                        ? tp(locale, "hw.liveHertz", { hz: liveSample.hz, samples: liveSample.samples })
                        : "—"}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            {report && !running ? (
              <div className={`hardware-test-banner ${report.verdict}`} role="status">
                <svg className="hardware-test-banner-glyph" viewBox="0 0 24 24" aria-hidden="true">
                  {report.verdict === "pass" ? (
                    <path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  ) : report.verdict === "fail" ? (
                    <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  ) : (
                    <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  )}
                </svg>
                <div className="hardware-test-banner-text">
                  <strong>{verdictLabel}</strong>
                  <span>{tp(locale, "hw.finishTime", { s: (report.durationMs / 1000).toFixed(1) })}</span>
                </div>
                <div className="hardware-test-banner-counts">
                  <span className="ok">{passed} OK</span>
                  <span className="fail">{failed} FAIL</span>
                  <span className="skip">{skipped} SKIP</span>
                </div>
              </div>
            ) : null}

            <div className="hardware-test-panel-bar">
              <button
                className="hardware-test-btn hardware-test-btn-connect"
                type="button"
                disabled={connecting || running || snapshot.connectDisabled}
                onClick={connectDevice}
              >
                {connecting ? "…" : t(locale, "hw.connect")}
              </button>
              <button className="hardware-test-btn hardware-test-btn-start" type="button" disabled={running} onClick={startTest}>
                {t(locale, "hw.start")}
              </button>
              {running ? (
                <button className="hardware-test-btn hardware-test-btn-end" type="button" onClick={endTest}>
                  {t(locale, "hw.end")}
                </button>
              ) : null}
              <button
                className="hardware-test-btn hardware-test-btn-share"
                type="button"
                disabled={!report || sharing || running}
                onClick={shareReport}
              >
                {sharing ? "…" : t(locale, "hw.share")}
              </button>
            </div>
          </div>
          {info.present ? (
            <aside className="hardware-test-status" aria-label={t(locale, "hw.deviceCard")}>
              <div className="hardware-test-status-head">
                <span className="hardware-test-status-title">{t(locale, "hw.deviceCard")}</span>
              </div>
              <div className="mouse-test-device-rows">
                {info.vendorId !== null && info.productId !== null && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "hw.identity")}</span>
                    <span className="mouse-test-device-val">
                      {formatHexId(info.vendorId)} / {formatHexId(info.productId)}
                    </span>
                  </div>
                )}
                <div className="mouse-test-device-row">
                  <span className="mouse-test-device-key">{t(locale, "hw.transport")}</span>
                  <span className="mouse-test-device-val">{info.transport === "bridge" ? "OpenMouse Bridge" : "WebHID"}</span>
                </div>
                {info.connectionType && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "test.connection")}</span>
                    <span className="mouse-test-device-val">{info.connectionType}</span>
                  </div>
                )}
                {info.signalStrength !== null && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "hw.signal")}</span>
                    <span className="mouse-test-device-val">{info.signalStrength}%</span>
                  </div>
                )}
                {info.receiverOnline !== null && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "hw.receiver")}</span>
                    <span className="mouse-test-device-val">
                      {info.pairingInProgress ? "pairing…" : info.receiverOnline ? "online" : "offline"}
                      {info.receiverRfId ? ` · RF ${info.receiverRfId}` : ""}
                    </span>
                  </div>
                )}
                {info.collectionsSummary && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "hw.interfaces")}</span>
                    <span className="mouse-test-device-val mouse-test-device-val-wrap">{info.collectionsSummary}</span>
                  </div>
                )}
                {info.driverFamily && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "hw.driver")}</span>
                    <span className="mouse-test-device-val">{info.driverFamily}</span>
                  </div>
                )}
                {info.pollingRateHz !== null && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "test.reportedHz")}</span>
                    <span className="mouse-test-device-val">{info.pollingRateHz} Hz</span>
                  </div>
                )}
                {info.supportedPollingRates && info.supportedPollingRates.length > 0 && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "hw.rates")}</span>
                    <span className="mouse-test-device-val">{info.supportedPollingRates.join(" / ")} Hz</span>
                  </div>
                )}
                {info.dpi !== null && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "test.dpi")}</span>
                    <span className="mouse-test-device-val">{info.dpi.toLocaleString()}</span>
                  </div>
                )}
                {info.dpiStages && info.dpiStages.length > 0 && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "test.dpiStages")}</span>
                    <span className="mouse-test-device-val mouse-test-dpi-stages">
                      {info.dpiStages.map((stage, index) => (
                        <span key={index} className={`mouse-test-dpi-chip${index === info.activeDpiStage ? " active" : ""}`}>
                          {stage.toLocaleString()}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {info.liftOffDistance && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "hw.lod")}</span>
                    <span className="mouse-test-device-val">{info.liftOffDistance}</span>
                  </div>
                )}
                {info.batteryPercent !== null && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "test.battery")}</span>
                    <span className="mouse-test-device-val">
                      {info.batteryPercent}% ({info.batteryState})
                    </span>
                  </div>
                )}
                {info.firmware && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "test.firmware")}</span>
                    <span className="mouse-test-device-val">{info.firmware.join(", ")}</span>
                  </div>
                )}
                {info.deviceMode && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "hw.mode")}</span>
                    <span className="mouse-test-device-val">{info.deviceMode}</span>
                  </div>
                )}
              </div>
            </aside>
          ) : null}
        </section>
      </div>
    </div>
  );
}