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
  // GearHub-V5 (Attack Shark R2, Lingbao M5 Pro): reads debounce, standby time
  // and the two "move correction" toggles out of its OPTIONPARAM0 block. Not a
  // CompX direct-mode driver — it publishes its own debounce/sleep option
  // lists, so it takes the plain flags.
  gearhub: { advancedSection: true, sleep: true, debounce: true },
  // MCHOSE reads debounce and sleep from its config blob and writes both, but
  // it is not a direct-mode (CompX) driver, so it takes the plain flags.
  mchose: { advancedSection: true, sleep: true, debounce: true },
  // Incott supports a 0-30 ms debounce and a 1-900 s sleep timer over its own
  // vendor protocol, not the CompX direct-mode transport, so it takes the
  // plain flags rather than DIRECT_MODE (its advancedSection already comes
  // from ui.showAdvancedSection, but sleep/debounce still need the flags
  // here or the cards never render regardless of applyPulsarValue's list).
  incott: { advancedSection: true, sleep: true, debounce: true },
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
