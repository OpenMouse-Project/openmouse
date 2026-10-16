import type { InterfaceLocale } from "../interface-preferences";
import { tp } from "../i18n.ts";

/** Saved names are user data; only the generated numbered fallback is localized. */
export function profileLabel(locale: InterfaceLocale, names: readonly string[] | undefined, index: number): string {
  return names?.[index] ?? tp(locale, "adv.profileOpt", { n: index + 1 });
}
