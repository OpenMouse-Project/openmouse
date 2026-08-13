/**
 * Development preview routes accepted by the control app.
 *
 * Keep this as an explicit allowlist: arbitrary query-string values must not
 * be able to disable the real HID startup path.
 */
export const PREVIEW_KEYS = [
  "list",
  "slots",
  "superstrike",
  "pulsar",
  "pulsar-pro",
  "egg-op1",
  "egg-we",
  "egg-xm2we",
  "wlmouse",
  "lamzu",
  "attack-shark",
  "crdrako",
  "m3k",
  "atk",
  "orbital",
  "razer",
  "razer-viper-mini",
  "razer-cobra",
  "razer-viper-v4",
  "teevolution",
  "vgn",
  "finalmouse",
  "ninjutso",
  "keychron",
  "logitech-legacy",
] as const;

export type PreviewMode = typeof PREVIEW_KEYS[number];
export type FixturePreviewMode = Exclude<PreviewMode, "list" | "slots" | "superstrike">;

/** Preview fixtures are available locally and on the deployed insiders app,
    but never on a stable production build. */
export function previewsEnabled(buildChannel: string, viteDev: boolean): boolean {
  return viteDev || buildChannel === "insiders";
}

/** Returns only trusted literals, breaking the data flow from the URL value. */
export function parsePreviewMode(value: string | null): PreviewMode | null {
  switch (value) {
    case "list": return "list";
    case "slots": return "slots";
    case "superstrike": return "superstrike";
    case "pulsar": return "pulsar";
    case "pulsar-pro": return "pulsar-pro";
    case "egg-op1": return "egg-op1";
    case "egg-we": return "egg-we";
    case "egg-xm2we": return "egg-xm2we";
    case "wlmouse": return "wlmouse";
    case "lamzu": return "lamzu";
    case "attack-shark": return "attack-shark";
    case "crdrako": return "crdrako";
    case "m3k": return "m3k";
    case "atk": return "atk";
    case "orbital": return "orbital";
    case "razer": return "razer";
    case "razer-viper-mini": return "razer-viper-mini";
    case "razer-cobra": return "razer-cobra";
    case "razer-viper-v4": return "razer-viper-v4";
    case "teevolution": return "teevolution";
    case "vgn": return "vgn";
    case "finalmouse": return "finalmouse";
    case "ninjutso": return "ninjutso";
    case "keychron": return "keychron";
    case "logitech-legacy": return "logitech-legacy";
    default: return null;
  }
}
