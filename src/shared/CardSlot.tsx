import {
  Activity, BatteryLow, Cog, Command, Cpu, Crosshair, Disc3, FlaskConical, Gauge, Hand, Layers, Lightbulb, Magnet,
  Moon, Mouse, MousePointerClick, Palette, Radar, Rocket, ScanEye, ShieldCheck, SlidersHorizontal, Sparkles,
  Spline, Timer, ToggleRight, Usb, Wifi, Zap, type LucideIcon,
} from "lucide-react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

const GLYPHS: Readonly<Record<string, LucideIcon>> = {
  dpi: Crosshair,
  polling: Activity,
  sensor: ScanEye,
  "wallhack-scanning": Radar,
  "wallhack-curves": Spline,
  "atk-sensor": ScanEye,
  lightforce: Zap,
  "finalmouse-tmr": Magnet,
  "ninjutso-sensor": ScanEye,
  "ninjutso-click": MousePointerClick,
  processing: Cpu,
  eggfilter: SlidersHorizontal,
  eggsensor: ScanEye,
  eggpolling: FlaskConical,
  eggcpi: Layers,
  "power-mode": Rocket,
  debounce: Timer,
  eggspdt: ToggleRight,
  egghanded: Hand,
  eggbuttons: Mouse,
  razerbuttons: Mouse,
  "mxmaster-buttons": Mouse,
  "atk-buttons": Mouse,
  "button-mapping": Mouse,
  "ksnake-scroll": Disc3,
  "ksnake-macros": Command,
  "wallhack-macros": Command,
  signal: Wifi,
  sleep: Moon,
  lighting: Lightbulb,
  "lighting-tab": Lightbulb,
  lowpower: BatteryLow,
  "finalmouse-pp": Gauge,
  finalmouse: Cog,
  "finalmouse-profiles": Layers,
  incott: Cog,
  "lunafury-buttons": Mouse,
  "lunafury-wheel": ShieldCheck,
  "dongle-led": Usb,
  "atk-profile": Layers,
  "atk-receiver": Usb,
  "atk-dongle": Usb,
  "onboard-profile": Layers,
  pulsarpro: Sparkles,
  "dpi-indicator": Palette,
};

const WIDE = new Set(["dpi", "eggpolling", "eggcpi", "eggbuttons", "ksnake-macros", "wallhack-macros", "lighting-tab", "button-mapping"]);

export function slotCards(cards: readonly ReactNode[]): ReactNode[] {
  return Children.toArray(cards).map((card) => {
    if (!isValidElement(card)) return card;
    const key = String((card as ReactElement).key ?? "").replace(/^\.\$/, "");
    const Glyph = GLYPHS[key];
    return (
      <div key={key} className={`card-slot${WIDE.has(key) ? " is-wide" : ""}`} data-card={key}>
        {card}
        {Glyph ? (
          <span className="card-glyph" aria-hidden="true">
            <Glyph strokeWidth={1.8} />
          </span>
        ) : null}
      </div>
    );
  });
}
