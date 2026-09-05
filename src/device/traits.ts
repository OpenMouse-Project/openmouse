import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

export interface DriverTraits {
  advancedSection: boolean;
  signal: boolean;
  sleep: boolean;
  debounce: boolean;
  eggControls: boolean;
  eggFamily: boolean;
  directMode: boolean;
  ninjutso: boolean;
  teevolution: boolean;
  finalmouse: boolean;
  logitech: boolean;
}

const NONE: DriverTraits = {
  advancedSection: false,
  signal: false,
  sleep: false,
  debounce: false,
  eggControls: false,
  eggFamily: false,
  directMode: false,
  ninjutso: false,
  teevolution: false,
  finalmouse: false,
  logitech: false,
};

const SHARED_ADVANCED = { advancedSection: true, signal: true, sleep: true, debounce: true } as const;
const DIRECT_MODE = { advancedSection: true, sleep: true, debounce: true, directMode: true } as const;

const BY_FAMILY: Readonly<Record<string, Partial<DriverTraits>>> = {
  "logitech-hidpp": { logitech: true },
  "egg-op1": { advancedSection: true, eggControls: true, eggFamily: true },
  "egg-we": { eggFamily: true },
  "finalmouse-ulx": { advancedSection: true, finalmouse: true },
  pulsar: SHARED_ADVANCED,
  teevolution: { ...SHARED_ADVANCED, teevolution: true },
  vgn: SHARED_ADVANCED,
  wlmouse: DIRECT_MODE,
  lamzu: DIRECT_MODE,
  "attack-shark": DIRECT_MODE,
  crdrako: DIRECT_MODE,
  atk: DIRECT_MODE,
  "atk-bitmouse": DIRECT_MODE,
  ninjutso: { ...DIRECT_MODE, ninjutso: true },
  "keychron-nape": { advancedSection: true, sleep: true, directMode: true },
  fantech: { advancedSection: true, sleep: true, directMode: true },
};

const BY_BRAND: Readonly<Record<string, string>> = {
  Teevolution: "teevolution",
  Orbital: "orbital",
  Pulsar: "pulsar",
  VGN: "vgn",
  Logitech: "logitech-hidpp",
  "Attack Shark": "attack-shark",
};

export function familyOf(status: MouseStatus): string {
  return status.ui?.family ?? BY_BRAND[status.brand] ?? status.brand.toLowerCase();
}

export function traitsFor(status: MouseStatus | null): DriverTraits {
  if (!status) return NONE;
  const family = familyOf(status);
  const ui = status.ui;
  const traits = { ...NONE, ...BY_FAMILY[family] };
  return {
    ...traits,
    advancedSection: traits.advancedSection || ui?.showAdvancedSection === true,
    signal: traits.signal && ui?.hideSignalCard !== true,
    sleep: traits.sleep && ui?.hideSleepCard !== true,
    eggControls: traits.eggControls
      || (status.brand === "Endgame Gear" && Array.isArray(status.eggCpiStages)),
  };
}

export function isPulsarProProtocol(status: MouseStatus): boolean {
  return status.connectionDetail?.includes("Pulsar Pro protocol") === true;
}
