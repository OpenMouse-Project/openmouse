import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ControlSnapshot } from "../device/types";
import { t } from "../i18n";

type TestPhase = "idle" | "countdown" | "sampling" | "done";

interface TestResults {
  avgHz: number;
  peakHz: number;
  low5Hz: number;
  jitter: number;
  stability: number;
  dropouts: number;
  events: number;
  duration: number;
  avgInterval: number;
  intervals: number[];
}

interface ButtonState {
  left: boolean;
  right: boolean;
  middle: boolean;
  back: boolean;
  forward: boolean;
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const SAMPLE_WINDOW = 200;
const DURATION_OPTIONS = [5, 8, 10] as const;

function computeResults(intervals: number[], durationMs: number): TestResults {
  const filtered = intervals.filter((ms) => ms > 0.25 && ms <= 1000);
  if (filtered.length < 2) {
    return { avgHz: 0, peakHz: 0, low5Hz: 0, jitter: 0, stability: 0, dropouts: 0, events: 0, duration: 0, avgInterval: 0, intervals: [] };
  }
  const hzValues = filtered.map((ms) => 1000 / ms).filter((h) => h > 0 && h < 20000);
  const sorted = [...hzValues].sort((a, b) => a - b);
  const sumMs = filtered.reduce((s, v) => s + v, 0);
  const avg = (filtered.length * 1000) / sumMs;
  const peak = sorted[sorted.length - 1]!;
  const low5Idx = Math.max(0, Math.floor(sorted.length * 0.05));
  const low5 = sorted[low5Idx]!;
  const meanInterval = sumMs / filtered.length;
  const variance = filtered.reduce((s, v) => s + (v - meanInterval) ** 2, 0) / filtered.length;
  const stdDev = Math.sqrt(variance);
  const jitter = meanInterval > 0 ? (stdDev / meanInterval) * 100 : 0;
  const stability = Math.max(0, 100 - jitter);
  const expectedInterval = avg > 0 ? 1000 / avg : 1;
  const dropouts = filtered.filter((ms) => ms > expectedInterval * 2.5).length;
  return { avgHz: avg, peakHz: peak, low5Hz: low5, jitter, stability, dropouts, events: hzValues.length, duration: durationMs / 1000, avgInterval: meanInterval, intervals };
}

const LIVE_WINDOW = 24;

function rollingLiveHz(intervals: number[]): number {
  const recent = intervals.slice(-LIVE_WINDOW);
  if (recent.length < 3) return 0;
  const sorted = recent.map((ms) => (ms > 0 ? 1000 / ms : 0)).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function drawChart(canvas: HTMLCanvasElement, intervals: number[], targetHz: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CHART_WIDTH * dpr;
  canvas.height = CHART_HEIGHT * dpr;
  canvas.style.width = `${CHART_WIDTH}px`;
  canvas.style.height = `${CHART_HEIGHT}px`;
  ctx.scale(dpr, dpr);

  const w = CHART_WIDTH;
  const h = CHART_HEIGHT;
  const pad = { top: 20, bottom: 30, left: 50, right: 16 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const styles = getComputedStyle(canvas);
  const color = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
  const panel = color("--surface-panel", "#0e1012");
  const lineSoft = color("--line-soft", "#25292e");
  const dim = color("--dim", "#6c727b");
  const info = color("--info", "#67d8ff");
  const infoSoft = `${info}28`;
  const infoFaint = "transparent";

  ctx.clearRect(0, 0, w, h);

  const recent = intervals.slice(-SAMPLE_WINDOW);
  if (recent.length < 2) {
    ctx.clearRect(0, 0, w, h);
    return;
  }

  const hzValues = recent.map((ms) => (ms > 0 ? Math.min(1000 / ms, 10000) : 0));
  const maxHz = Math.max(targetHz * 1.5, ...hzValues) * 1.1;
  const minHz = 0;

  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, w, h);

  const gridLines = 4;
  ctx.strokeStyle = lineSoft;
  ctx.lineWidth = 0.5;
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillStyle = dim;
  ctx.textAlign = "right";
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + (plotH / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    const hzLabel = Math.round(maxHz - (maxHz - minHz) * (i / gridLines));
    ctx.fillText(`${hzLabel}`, pad.left - 6, y + 3);
  }

  if (targetHz > 0) {
    const targetY = pad.top + plotH * (1 - targetHz / maxHz);
    ctx.strokeStyle = infoSoft;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, targetY);
    ctx.lineTo(w - pad.right, targetY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = infoSoft;
    ctx.textAlign = "left";
    ctx.fillText(`${targetHz} Hz target`, w - pad.right - 70, targetY - 4);
  }

  const step = plotW / (SAMPLE_WINDOW - 1);
  ctx.beginPath();
  ctx.strokeStyle = info;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  for (let i = 0; i < hzValues.length; i++) {
    const x = pad.left + i * step;
    const y = pad.top + plotH * (1 - (hzValues[i] ?? 0) / maxHz);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  gradient.addColorStop(0, infoSoft);
  gradient.addColorStop(1, infoFaint);
  ctx.lineTo(pad.left + (hzValues.length - 1) * step, pad.top + plotH);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.fillStyle = dim;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Samples", w / 2, h - 4);
}

function formatHz(hz: number): string {
  return hz > 0 ? `${Math.round(hz)}` : "--";
}

function stabilityClass(stability: number): string {
  if (stability >= 90) return "is-good";
  if (stability >= 70) return "is-mid";
  return "is-poor";
}

export function MouseTestPage({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const status = snapshot.status;

  const [phase, setPhase] = useState<TestPhase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [duration, setDuration] = useState<8 | 5 | 10>(8);
  const [elapsed, setElapsed] = useState(0);
  const [liveHz, setLiveHz] = useState(0);
  const [results, setResults] = useState<TestResults | null>(null);
  const [chartIntervals, setChartIntervals] = useState<number[]>([]);
  const [buttons, setButtons] = useState<ButtonState>({ left: false, right: false, middle: false, back: false, forward: false });

  const intervalsRef = useRef<number[]>([]);
  const lastTimeRef = useRef(0);
  const phaseRef = useRef<TestPhase>("idle");
  const startTimeRef = useRef(0);
  const timerRef = useRef<number>(0);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (phaseRef.current !== "sampling") return;
    const subEvents =
      typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents().length > 0
        ? e.getCoalescedEvents()
        : [e];
    for (const event of subEvents) {
      const t = event.timeStamp;
      if (lastTimeRef.current > 0) {
        const delta = t - lastTimeRef.current;
        if (delta >= 0.25 && delta <= 1000) {
          intervalsRef.current.push(delta);
        }
      }
      lastTimeRef.current = t;
    }
    if (intervalsRef.current.length > 0) {
      setLiveHz(rollingLiveHz(intervalsRef.current));
      setChartIntervals([...intervalsRef.current].slice(-SAMPLE_WINDOW));
    }
  }, []);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    const key = e.button === 0 ? "left" : e.button === 1 ? "middle" : e.button === 2 ? "right" : e.button === 3 ? "back" : e.button === 4 ? "forward" : null;
    if (key) setButtons((prev) => ({ ...prev, [key]: true }));
  }, []);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const key = e.button === 0 ? "left" : e.button === 1 ? "middle" : e.button === 2 ? "right" : e.button === 3 ? "back" : e.button === 4 ? "forward" : null;
    if (key) setButtons((prev) => ({ ...prev, [key]: false }));
  }, []);

  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (canvas) drawChart(canvas, chartIntervals, status?.pollingRateHz ?? 1000);
  }, [chartIntervals, status?.pollingRateHz]);

  const startTest = useCallback(() => {
    intervalsRef.current = [];
    lastTimeRef.current = 0;
    setLiveHz(0);
    setResults(null);
    setChartIntervals([]);
    setElapsed(0);
    setPhase("countdown");
    setCountdown(3);

    let count = 3;
    const countdownTimer = window.setInterval(() => {
      count--;
      if (count <= 0) {
        window.clearInterval(countdownTimer);
        setPhase("sampling");
        startTimeRef.current = performance.now();
        let elapsed = 0;
        timerRef.current = window.setInterval(() => {
          elapsed = performance.now() - startTimeRef.current;
          setElapsed(elapsed / 1000);
          if (elapsed >= duration * 1000) {
            window.clearInterval(timerRef.current);
            setResults(computeResults(intervalsRef.current, elapsed));
            setPhase("done");
          }
        }, 50);
      } else {
        setCountdown(count);
      }
    }, 1000);
  }, [duration]);

  const resetTest = useCallback(() => {
    window.clearInterval(timerRef.current);
    intervalsRef.current = [];
    lastTimeRef.current = 0;
    setPhase("idle");
    setLiveHz(0);
    setResults(null);
    setChartIntervals([]);
    setElapsed(0);
    setButtons({ left: false, right: false, middle: false, back: false, forward: false });
  }, []);

  useEffect(() => {
    return () => window.clearInterval(timerRef.current);
  }, []);

  const targetHz = status?.pollingRateHz ?? 1000;
  const sensorDpi = status?.dpi ?? 0;
  const dpiStages = status?.dpiStages;
  const dpiColors = status?.dpiStageColors;
  const activeStage = status?.activeDpiStage;

  return (
    <div className="mouse-test-page">
      <div className="mouse-test-header">
        <h1 className="mouse-test-title">{t(locale, "test.title")}</h1>
        <p className="mouse-test-subtitle">{t(locale, "test.subtitle")}</p>
      </div>

      <div className="mouse-test-grid">
        <div className="mouse-test-main">
          <div
            className={`mouse-test-area${phase === "sampling" ? " active" : ""}`}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="mouse-test-chip mouse-test-chip-left">
              {phase === "idle" && t(locale, "test.ready")}
              {phase === "countdown" && t(locale, "test.getReady")}
              {phase === "sampling" && t(locale, "test.sampling")}
              {phase === "done" && t(locale, "test.complete")}
            </div>
            <div className="mouse-test-chip mouse-test-chip-right">
              {phase === "idle" && "—"}
              {phase === "countdown" && `${countdown}`}
              {phase === "sampling" && `${elapsed.toFixed(1)}s / ${duration}s`}
              {phase === "done" && results && `${results.events} samples`}
            </div>

            {phase === "idle" && (
              <div className="mouse-test-idle">
                <div className="mouse-test-idle-icon">&#x1F5B1;</div>
                <p>{t(locale, "test.movePrompt")}</p>
              </div>
            )}
            {phase === "countdown" && (
              <div className="mouse-test-countdown">{countdown}</div>
            )}
            {phase === "sampling" && (
              <div className="mouse-test-live">
                <div className="mouse-test-live-hz">{formatHz(liveHz)}</div>
                <div className="mouse-test-live-label">Hz</div>
                <div className="mouse-test-live-bar">
                  <div
                    className="mouse-test-live-bar-fill"
                    style={{ width: `${Math.min(100, (liveHz / Math.max(targetHz * 1.5, 1)) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {phase === "done" && results && (
              <div className="mouse-test-done">
                <div className="mouse-test-done-hz">{formatHz(results.avgHz)}</div>
                <div className="mouse-test-done-label">{t(locale, "test.avgHz")}</div>
              </div>
            )}

            <div className="mouse-test-area-note">{t(locale, "test.areaNote")}</div>
          </div>

          <div className="mouse-test-controls">
            {phase === "idle" && (
              <div className="mouse-test-duration-picker">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d}
                    className={`mouse-test-duration-btn${duration === d ? " active" : ""}`}
                    type="button"
                    onClick={() => setDuration(d as 5 | 8 | 10)}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            )}
            {phase === "idle" && (
              <button className="mouse-test-start-btn" type="button" onClick={startTest}>
                {t(locale, "test.start")}
              </button>
            )}
            {phase === "done" && (
              <button className="mouse-test-reset-btn" type="button" onClick={resetTest}>
                {t(locale, "test.reset")}
              </button>
            )}
          </div>

          <div className="mouse-test-chart-container">
            <canvas ref={chartCanvasRef} className="mouse-test-chart" />
          </div>

          {results && results.events > 0 && (
            <div className="mouse-test-results">
              <div className="mouse-test-result-card">
                <span className="mouse-test-result-label">{t(locale, "test.avgHz")}</span>
                <span className="mouse-test-result-value">{formatHz(results.avgHz)}</span>
                <span className="mouse-test-result-unit">Hz</span>
              </div>
              <div className="mouse-test-result-card">
                <span className="mouse-test-result-label">{t(locale, "test.peakHz")}</span>
                <span className="mouse-test-result-value">{formatHz(results.peakHz)}</span>
                <span className="mouse-test-result-unit">Hz</span>
              </div>
              <div className="mouse-test-result-card">
                <span className="mouse-test-result-label">{t(locale, "test.low5")}</span>
                <span className="mouse-test-result-value">{formatHz(results.low5Hz)}</span>
                <span className="mouse-test-result-unit">Hz</span>
              </div>
              <div className="mouse-test-result-card">
                <span className="mouse-test-result-label">{t(locale, "test.stability")}</span>
                <span className={`mouse-test-result-value mouse-test-stability ${stabilityClass(results.stability)}`}>
                  {results.stability.toFixed(1)}%
                </span>
              </div>
              <div className="mouse-test-result-card">
                <span className="mouse-test-result-label">{t(locale, "test.jitter")}</span>
                <span className="mouse-test-result-value">{results.jitter.toFixed(1)}%</span>
              </div>
              <div className="mouse-test-result-card">
                <span className="mouse-test-result-label">{t(locale, "test.dropouts")}</span>
                <span className="mouse-test-result-value">{results.dropouts}</span>
              </div>
              <div className="mouse-test-result-card">
                <span className="mouse-test-result-label">{t(locale, "test.events")}</span>
                <span className="mouse-test-result-value">{results.events}</span>
              </div>
              <div className="mouse-test-result-card">
                <span className="mouse-test-result-label">{t(locale, "test.avgInterval")}</span>
                <span className="mouse-test-result-value">{results.avgInterval.toFixed(2)}</span>
                <span className="mouse-test-result-unit">ms</span>
              </div>
            </div>
          )}
        </div>

        <div className="mouse-test-sidebar">
          {status && (
            <div className="mouse-test-device-card">
              <h3 className="mouse-test-device-title">{t(locale, "test.deviceInfo")}</h3>
              <div className="mouse-test-device-rows">
                <div className="mouse-test-device-row">
                  <span className="mouse-test-device-key">{t(locale, "test.deviceName")}</span>
                  <span className="mouse-test-device-val">{status.brand} {status.name}</span>
                </div>
                <div className="mouse-test-device-row">
                  <span className="mouse-test-device-key">{t(locale, "test.connection")}</span>
                  <span className="mouse-test-device-val">{status.connectionType ?? "--"}</span>
                </div>
                <div className="mouse-test-device-row">
                  <span className="mouse-test-device-key">{t(locale, "test.reportedHz")}</span>
                  <span className="mouse-test-device-val">{status.pollingRateHz} Hz</span>
                </div>
                <div className="mouse-test-device-row">
                  <span className="mouse-test-device-key">{t(locale, "test.dpi")}</span>
                  <span className="mouse-test-device-val">{sensorDpi.toLocaleString()}</span>
                </div>
                {dpiStages && dpiStages.length > 0 && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "test.dpiStages")}</span>
                    <span className="mouse-test-device-val mouse-test-dpi-stages">
                      {dpiStages.map((d, i) => (
                        <span
                          key={i}
                          className={`mouse-test-dpi-chip${i === activeStage ? " active" : ""}`}
                          style={dpiColors?.[i] ? { borderColor: dpiColors[i] } : undefined}
                        >
                          {d.toLocaleString()}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {status.batteryPercent !== null && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "test.battery")}</span>
                    <span className="mouse-test-device-val">
                      {status.batteryPercent}% ({status.batteryState})
                    </span>
                  </div>
                )}
                {status.firmware.length > 0 && (
                  <div className="mouse-test-device-row">
                    <span className="mouse-test-device-key">{t(locale, "test.firmware")}</span>
                    <span className="mouse-test-device-val">{status.firmware.join(", ")}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {!status && (
            <div className="mouse-test-device-card mouse-test-no-device">
              <h3 className="mouse-test-device-title">{t(locale, "test.deviceInfo")}</h3>
              <p className="mouse-test-no-device-text">{t(locale, "test.noDevice")}</p>
            </div>
          )}

          <div className="mouse-test-device-card">
            <h3 className="mouse-test-device-title">{t(locale, "test.buttonTest")}</h3>
            <div className="mouse-test-button-grid">
              {(["left", "right", "middle", "back", "forward"] as const).map((btn) => (
                <div key={btn} className={`mouse-test-btn-indicator${buttons[btn] ? " pressed" : ""}`}>
                  <div className="mouse-test-btn-circle" />
                  <span className="mouse-test-btn-label">{t(locale, `test.btn.${btn}`)}</span>
                </div>
              ))}
            </div>
            <p className="mouse-test-button-hint">{t(locale, "test.buttonHint")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
