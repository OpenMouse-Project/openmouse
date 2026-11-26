import { useEffect, useId, useRef, useState } from "react";
import type { MagneticButtonsStatus } from "@openmouse/protocol/drivers/mouse-types";
import type { InterfaceLocale } from "../settings/interface-preferences";
import { t } from "../../i18n/index";
import { subscribeButtonDepth } from "../../device/controller";

type Sample = { time: number; depths: [number, number] };

/** Only received device samples enter the three-second travel window. */
export function MagneticTravel({ magnetic, locale, brand }: {
  magnetic: MagneticButtonsStatus; locale: InterfaceLocale; brand: string;
}) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const received = useRef<Sample[]>([]);
  const traces = useRef<Array<SVGPolylineElement | null>>([]);
  const activeTraces = useRef<Array<SVGPolylineElement | null>>([]);
  const areas = useRef<Array<SVGPathElement | null>>([]);
  const thresholds = useRef<Array<number | null>>([]);
  const plotId = useId().replace(/:/g, "");
  const levelScale = brand === "Keychron";
  const maximum = levelScale ? 12 : 100;
  const depthValue = (percent: number) => levelScale ? Math.max(0, Math.min(12, (Math.round(percent * .65) - 5) / 5)) : percent;
  useEffect(() => {
    const clear = () => { received.current = []; setSamples([]); };
    const stop = subscribeButtonDepth((left, right) => {
      if (!Number.isFinite(left) || !Number.isFinite(right)) { clear(); return; }
      const time = performance.now();
      received.current = [...received.current.filter(s => time - s.time < 3000), {
        time, depths: [Math.max(0, Math.min(100, left)), Math.max(0, Math.min(100, right))] as [number, number],
      }].slice(-300);
      setSamples(received.current);
    });
    const stale = setInterval(() => {
      const last = received.current[received.current.length - 1];
      if (last && performance.now() - last.time > 1500) clear();
    }, 500);
    // Scroll the time axis every display frame, independently of HID sample arrival.
    // Only received points are drawn; no synthetic travel values are interpolated.
    let frame = 0;
    const draw = () => {
      const now = performance.now();
      const visible = received.current.filter(sample => now - sample.time <= 3000);
      traces.current.forEach((trace, side) => {
        const points = visible.map(sample => `${598 - (now - sample.time) / 3000 * 566},${10 + depthValue(sample.depths[side]!) / maximum * 220}`);
        trace?.setAttribute("points", points.join(" "));
        activeTraces.current[side]?.setAttribute("points", points.join(" "));
        const threshold = thresholds.current[side];
        const first = visible[0], last = visible[visible.length - 1];
        const y = 10 + (threshold ?? 0) / maximum * 220;
        areas.current[side]?.setAttribute("d", first && last && threshold != null
          ? `M${598 - (now - first.time) / 3000 * 566},${y} L${points.join(" L")} L${598 - (now - last.time) / 3000 * 566},${y} Z` : "");
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { stop(); clearInterval(stale); cancelAnimationFrame(frame); };
  }, [brand]);
  const latest = samples[samples.length - 1];
  return <div className="magnetic-travel">
    <strong>{t(locale, "magnetic.liveTravel")}</strong>
    {!latest ? <p role="status">{t(locale, "magnetic.waitingTravel")}</p> : null}
    <div className="magnetic-travel-grid">
      {([0, 1] as const).map(side => {
        const button = magnetic.buttons[side]!;
        const point = button.triggerPoint;
        const threshold = point == null ? null : levelScale ? point : point / magnetic.triggerPointRange.max * 100;
        const label = t(locale, side === 0 ? "adv.leftButton" : "adv.rightButton");
        const activeThreshold = button.switchType === "optical" ? null : threshold;
        thresholds.current[side] = activeThreshold;
        const clipId = `${plotId}-${side}`;
        return <figure key={side}>
          <figcaption><span>{label}</span><output data-actuated={latest && activeThreshold !== null && depthValue(latest.depths[side]) >= activeThreshold}>{latest ? levelScale && depthValue(latest.depths[side]) < .5 ? "–" : `${Math.round(depthValue(latest.depths[side]))}${levelScale ? "" : "%"}` : "–"}</output></figcaption>
          <svg viewBox="0 0 600 250" role="img" aria-label={label}>
            <defs><clipPath id={clipId}><rect x="32" y={10 + (activeThreshold ?? maximum) / maximum * 220} width="566" height={activeThreshold === null ? 0 : (maximum - activeThreshold) / maximum * 220} /></clipPath></defs>
            {(levelScale ? [0, 2, 4, 6, 8, 10, 12] : [0, 50, 100]).map(value => <g key={value}>
              <line className="magnetic-travel-gridline" x1="32" x2="598" y1={10 + value / maximum * 220} y2={10 + value / maximum * 220} />
              <text x="0" y={14 + value / maximum * 220}>{value}</text>
            </g>)}
            {threshold !== null && button.switchType !== "optical" ? <line className="magnetic-travel-threshold"
              x1="32" x2="598" y1={10 + threshold / maximum * 220} y2={10 + threshold / maximum * 220} /> : null}
            <polyline className="magnetic-travel-line" ref={node => { traces.current[side] = node; }} />
            <g clipPath={`url(#${clipId})`}>
              <path className="magnetic-travel-active-area" ref={node => { areas.current[side] = node; }} />
              <polyline className="magnetic-travel-line magnetic-travel-active-line" ref={node => { activeTraces.current[side] = node; }} />
            </g>
          </svg>
        </figure>;
      })}
    </div>
  </div>;
}
