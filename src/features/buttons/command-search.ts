import type { InterfaceLocale } from "../settings/interface-preferences";
import { displayText } from "../../i18n/index.ts";

export function matchesCommandQuery(locale: InterfaceLocale, query: string, label: string, hint = ""): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const englishNeedle = trimmed.toLowerCase();
  const localizedNeedle = trimmed.toLocaleLowerCase(locale);
  return [label, hint].some((text) => text.toLowerCase().includes(englishNeedle)
    || displayText(locale, text).toLocaleLowerCase(locale).includes(localizedNeedle));
}
