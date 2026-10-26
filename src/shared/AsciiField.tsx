import { useEffect, useState, type ReactNode } from "react";
import { asciiRowTiming, asciiSessionSeed, asciiSweepRuns, nextAsciiField } from "./ascii";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function AsciiField({ theme, reducedMotion }: { theme: string; reducedMotion: boolean }): ReactNode {
  const seed = asciiSessionSeed();
  const [field, setField] = useState(() => nextAsciiField(null, window.innerWidth, seed));

  useEffect(() => {
    let frame = 0;
    const onResize = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setField((previous) => nextAsciiField(previous, window.innerWidth, seed)));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, [seed]);

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
}
