import type {
  ArbiterKeyBinding,
  ArbiterKeyTravel,
  ArbiterLightEffect,
  ArbiterProduct,
  ArbiterUserMode,
} from "@openmouse/keyboard-protocol/arbiter";

/** Everything the Arbiter panel shows, as the keyboard last confirmed it. */
export interface ArbiterWorkspace {
  product: ArbiterProduct;
  /** Actuation and rapid trigger per key, in wire order, in the firmware's own unit. */
  travel: readonly ArbiterKeyTravel[];
  light: ArbiterLightEffect | null;
  /** Bindings by layer, then wire order. Layer 1 is the FN layer on PRO models. */
  bindings: readonly (readonly ArbiterKeyBinding[])[];
  /** SuperTap state; null on models without it or when the keyboard would not answer. */
  userMode: ArbiterUserMode | null;
}

export type ArbiterCommand =
  | { kind: "arbiterTravel"; updates: readonly { index: number; make?: number; break?: number }[] }
  | { kind: "arbiterLight"; light: ArbiterLightEffect }
  | { kind: "arbiterBindings"; updates: readonly { layer: number; index: number; keyCode: number }[] }
  | { kind: "arbiterProfile"; profile: number }
  | { kind: "arbiterUserMode"; mode: ArbiterUserMode };
