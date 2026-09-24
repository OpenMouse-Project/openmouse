import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { t } from "../i18n";
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
  type HardwareTestStatus,
} from "../hardware-test-report";
import { crosscheckSupportedDevices } from "../supported-devices-crosscheck";

type TermLevel = "cmd" | "ok" | "fail" | "skip" | "info" | "user" | "err" | "warn";

interface TermLine {
  id: number;
  level: TermLevel;
  at: string;
  text: string;
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

function elapsedStamp(startedAtMs: number): string {
  const seconds = (performance.now() - startedAtMs) / 1000;
  return `t+${seconds.toFixed(1).padStart(5, " ")}s`;
}

function badgeFor(status: HardwareTestStatus, label: string, detail: string | null): string {
  const badge = status === "pass" ? "[ OK ]" : status === "fail" ? "[FAIL]" : "[SKIP]";
  return `${badge} ${label}${detail ? ` — ${detail}` : ""}`;
}

export function HardwareTestPage({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;

  const [lines, setLines] = useState<TermLine[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<HardwareTestReport | null>(null);
  const [sharing, setSharing] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const runningRef = useRef(false);
  const cancelRef = useRef(false);
  const startRef = useRef(0);
  const lineIdRef = useRef(0);
  const termBodyRef = useRef<HTMLDivElement>(null);

  const pushLine = useCallback((level: TermLevel, text: string): void => {
    setLines((prev) => [
      ...prev,
      { id: lineIdRef.current++, level, at: elapsedStamp(startRef.current), text },
    ]);
  }, []);

  useEffect(() => {
    const body = termBodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [lines]);

  const endTest = useCallback(() => {
    if (!runningRef.current) return;
    cancelRef.current = true;
    pushLine("user", "» end-test requested…");
  }, [pushLine]);

  const startTest = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    startRef.current = performance.now();
    lineIdRef.current = 0;
    setRunning(true);
    setReport(null);
    setLines([]);

    void (async () => {
      let info = deviceInfoFromSnapshot(snapshot);
      const results: HardwareTestResult[] = [];
      let aborted = false;
      const startedAt = performance.now();

      pushLine("cmd", "❯ openmouse-hardware-test");
      pushLine("info", `build ${snapshot.buildLabel} · hardware verification suite`);
      await sleep(200);

      const envParts: string[] = [];
      const webhid = typeof navigator !== "undefined" && "hid" in navigator;
      envParts.push(webhid ? "WebHID available" : "WebHID unavailable (Bridge can substitute)");
      pushLine("info", envParts.join(" · "));
      await sleep(240);

      if (info.present) {
        pushLine("cmd", `$ identity ${info.brand ?? ""} ${info.name ?? ""}`.trim());
        pushLine("info", `vid:pid ${formatHexId(info.vendorId ?? 0)}:${formatHexId(info.productId ?? 0)}`);
        pushLine("info", `${info.productName ?? ""} · ${info.transport === "bridge" ? "OpenMouse Bridge" : "WebHID"}${info.connectionType ? ` · ${info.connectionType}` : ""}`);
        const interfaces = await hidInterfacesSummary(info.vendorId, info.productId);
        if (interfaces) {
          info = { ...info, collectionsSummary: interfaces };
          pushLine("info", interfaces);
        }
        await sleep(320);
      } else {
        pushLine("warn", "no device connected —— device checks will fail, interactive checks will be skipped");
        await sleep(320);
      }

      const runCheckRow = async (check: HardwareTestResult): Promise<void> => {
        if (cancelRef.current) {
          aborted = true;
          results.push({ ...check, status: "skip" as const, detail: null });
          pushLine("skip", `[SKIP] ${check.label} — stopped by user`);
          return;
        }
        pushLine("cmd", `$ check ${check.label.toLowerCase().replaceAll(" ", "-")}`);
        await sleep(340);
        if (cancelRef.current) {
          aborted = true;
          results.push({ ...check, status: "skip" as const, detail: null });
          pushLine("skip", `[SKIP] ${check.label} — stopped by user`);
          return;
        }
        results.push(check);
        pushLine(samplingLevel(check.status), badgeFor(check.status, check.label, check.detail));
        await sleep(120);
      };

      // ── Automatic (driver read-back) checks ────────────────────────────
      for (const check of automaticChecks(info)) {
        await runCheckRow(check);
      }

      // ── Brand-specific checks (docs/*-testing.md checklists) ───────────
      for (const check of brandChecks(info)) {
        await runCheckRow(check);
      }

      // ── Interactive checks ─────────────────────────────────────────────
      if (info.present && !aborted) {
        // Polling-rate sampling: move the mouse over the window.
        pushLine("cmd", "$ test polling-rate-sampling");
        pushLine("user", "» Move the mouse in small circles — 5 seconds of sampling…");
        await sleep(400);
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
        const liveTimer = window.setInterval(() => {
          const live = rollingLiveHz(intervals);
          if (live > 0) pushLine("info", `  live ${formatHz(live)} Hz · ${intervals.length} samples`);
        }, 500);
        for (let waited = 0; waited < SAMPLE_WINDOW_MS && !cancelRef.current; waited += 150) await sleep(150);
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
        pushLine(samplingLevel(samplingResult.status), badgeFor(samplingResult.status, samplingResult.label, samplingResult.detail));
        await sleep(160);
      }

      // ── Flash write round-trip (write → read-back → restore) ───────────
      if (info.present && !aborted) {
        pushLine("cmd", "$ test flash-write-round-trip");
        await sleep(240);

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
          pushLine("user", `» writing ${leg.target}, reading it back, then restoring ${leg.current} — ${leg.note}`);
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
            pushLine("warn", "  → skip: staged changes are pending in the config UI");
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
        pushLine(samplingLevel(flashResult.status), badgeFor(flashResult.status, flashResult.label, flashResult.detail));
        await sleep(160);
      }

      // ── Summary ────────────────────────────────────────────────────────
      pushLine("cmd", "$ summary");
      const passed = results.filter((result) => result.status === "pass").length;
      const failed = results.filter((result) => result.status === "fail").length;
      const skipped = results.filter((result) => result.status === "skip").length;
      pushLine("info", `  passed ${passed} · failed ${failed} · skipped ${skipped}`);
      const verdict = verdictFor({ results, incomplete: aborted });
      pushLine(verdict === "pass" ? "ok" : verdict === "fail" ? "fail" : "skip", `VERDICT ${verdict.toUpperCase()}${aborted ? " — stopped before completion" : ""}`);

      // Crosscheck the device against the supported-devices page (the mirrored
      // table behind openmouse.app/supported): is it listed, and does this run
      // qualify it to move to "Supported"? Replaces pinging a maintainer: the
      // report now carries the page-side answer itself.
      pushLine("cmd", "$ crosscheck supported-devices");
      const supportedPage = crosscheckSupportedDevices(info, verdict);
      pushLine(supportedPage.listed ? (supportedPage.status === "supported" ? "info" : verdict === "pass" ? "ok" : "skip") : "info", `  ${supportedPage.detail}`);

      setReport({
        device: info,
        results,
        verdict,
        durationMs: performance.now() - startedAt,
        runAt: new Date().toISOString(),
        build: snapshot.buildLabel,
        supportedPage,
      });
    })().catch(() => {
      pushLine("err", "the suite crashed — restart the test");
      setReport(null);
    }).finally(() => {
      runningRef.current = false;
      setRunning(false);
    });
  }, [snapshot, pushLine]);

  const shareReport = useCallback(() => {
    if (!report || sharing || running) return;
    setSharing(true);
    pushLine("cmd", "$ share-report → /api/feedback");
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
          pushLine("err", `could not send the report${message ? ` — ${message}` : " — try again in a moment"}`);
          // Surface the relay's own reason when it answered (e.g. "Feedback is
          // not configured." or "Discord rejected the feedback.") instead of a
          // generic "unreachable" toast that hides whether this is a config,
          // delivery, or network problem.
          control.pushToast("error", t(locale, "hw.reportError"), message ?? t(locale, "hw.reportErrorDetail"));
          return;
        }
        pushLine("ok", "report sent to the OpenMouse feedback channel ✓");
        control.pushToast("success", t(locale, "hw.reportSent"), t(locale, "hw.reportSentDetail"));
      } catch {
        pushLine("err", "could not send the report — try again in a moment");
        control.pushToast("error", t(locale, "hw.reportError"), t(locale, "hw.reportErrorDetail"));
      } finally {
        setSharing(false);
      }
    })();
  }, [report, sharing, running, pushLine, locale]);

  // Opens the WebHID/Bridge device picker and connects the chosen mouse, then
  // reports the outcome in the terminal. Handy when the page opens with no
  // device connected, or to swap in a second unit for another shared report.
  const connectDevice = useCallback(() => {
    if (connecting || running) return;
    setConnecting(true);
    pushLine("cmd", "$ connect-device");
    pushLine("user", "» pick your mouse in the browser dialog…");
    void control
      .connect()
      .catch(() => undefined) // control.connect() handles failures internally; guard against rethrows.
      .finally(() => {
        const next = deviceInfoFromSnapshot(control.getSnapshot());
        if (next.present) {
          pushLine("ok", `connected ${[next.brand, next.name].filter(Boolean).join(" ").trim()}`);
        } else {
          pushLine("warn", "no device selected — connect a mouse to run the hardware tests");
        }
        setConnecting(false);
      });
  }, [connecting, running, pushLine]);

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

  return (
    <div className="mouse-test-page hardware-test-page">
      <div className="mouse-test-header">
        <h1 className="mouse-test-title">{t(locale, "hw.title")}</h1>
        <p className="mouse-test-subtitle">{t(locale, "hw.subtitle")}</p>
      </div>

      <div className="hardware-test-layout">
        {/* ── Left: device status card ─────────────────────────────────── */}
        <aside className="hardware-test-device">
          <div className="mouse-test-device-card">
            {info.present ? (
              <>
                <div className="hardware-test-device-name">
                  <span className="hardware-test-device-name-label">{t(locale, "hw.deviceCard")}:</span>
                  <span>
                    {info.brand} {info.name}
                  </span>
                </div>
                {snapshot.deviceArtwork ? (
                  <div className="hardware-test-art">
                    <img className="hardware-test-art-img" src={snapshot.deviceArtwork} alt="" />
                  </div>
                ) : null}
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
                {verdictLabel && report ? (
                  <div className={`hardware-test-verdict ${report.verdict}`}>
                    <span className={`hardware-test-verdict-dot ${report.verdict}`} />
                    {verdictLabel}
                  </div>
                ) : null}
                {report?.supportedPage ? (
                  <p className={`hardware-test-crosscheck${report.supportedPage.listed ? ` is-${report.supportedPage.status ?? "listed"}` : ""}`}>
                    {report.supportedPage.detail}
                  </p>
                ) : null}
              </>
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
          </div>
        </aside>

        {/* ── Right: live terminal ─────────────────────────────────────── */}
        <section className="hardware-test-terminal-wrap">
          <div className="hardware-test-terminal" role="log" aria-live="polite" aria-label={t(locale, "hw.termTitle")}>
            <div className="hardware-test-terminal-head">
              <span className="hardware-test-terminal-dots" aria-hidden="true">
                <i /><i /><i />
              </span>
              <span className="hardware-test-terminal-title">{t(locale, "hw.termTitle")}</span>
              <span className={`hardware-test-terminal-state${running ? " running" : ""}`}>
                {running ? "● running" : report ? (report.verdict === "pass" ? "● done" : report.verdict === "fail" ? "● failed" : "● stopped") : "○ idle"}
              </span>
            </div>

            <div className="hardware-test-terminal-body" ref={termBodyRef}>
              {lines.length === 0 ? (
                <p className="hardware-test-terminal-empty">{t(locale, "hw.ready")}</p>
              ) : null}
              {lines.map((line) => (
                <p key={line.id} className={`hardware-test-line hardware-test-line-${line.level}`}>
                  <span className="hardware-test-line-at">{line.at}</span>
                  {line.text}
                </p>
              ))}
              {running ? <span className="hardware-test-cursor" aria-hidden="true" /> : null}
            </div>

            {report && !running ? (
              <div className={`hardware-test-summary ${report.verdict}`}>
                <span className="hardware-test-summary-ok">{passed} OK</span>
                <span className="hardware-test-summary-fail">{failed} FAIL</span>
                <span className="hardware-test-summary-skip">{skipped} SKIP</span>
                <strong>{verdictLabel}</strong>
              </div>
            ) : null}

            <div className="hardware-test-terminal-bar">
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
        </section>
      </div>
    </div>
  );
}

/** Terminal level for a scored check result. */
function samplingLevel(status: HardwareTestStatus): TermLevel {
  return status === "pass" ? "ok" : status === "fail" ? "fail" : "skip";
}