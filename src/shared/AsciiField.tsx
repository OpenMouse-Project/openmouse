import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { asciiColumns, asciiRowTiming, asciiSessionSeed, asciiSweepRuns, nextAsciiField } from "./ascii";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const AsciiField = memo(function AsciiField({ theme, reducedMotion }: { theme: string; reducedMotion: boolean }): ReactNode {
  const seed = asciiSessionSeed();
  // SSR/test has no window: start at width 0, which clamps to ASCII_MIN_COLS.
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));

  useEffect(() => {
    let frame = 0;
    const onResize = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewportWidth(window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Rows depend only on the column count and the session seed: resizes that
  // keep the column count reuse the previous field instead of rebuilding it.
  const cols = asciiColumns(viewportWidth);
  const field = useMemo(() => nextAsciiField(null, viewportWidth, seed), [cols, seed]);

  const sweeping = asciiSweepRuns({ reducedMotion, prefersReducedMotion: prefersReducedMotion() });
  return (
    <div className="om-ascii" aria-hidden="true">
      <div key={theme} className={`om-ascii-field${sweeping ? " is-sweeping" : ""}`} data-cols={field.cols}>
        {field.rows.map((line, index) => {
          const timing = asciiRowTiming(index);
          return (
            <div key={index} className="om-ascii-row" style={{ "--ascii-a": String(timing.alpha), "--ascii-delay": `${timing.delayMs}ms` }}>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
});
