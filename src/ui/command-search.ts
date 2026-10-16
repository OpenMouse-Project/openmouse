import type { InterfaceLocale } from "../interface-preferences";
import { displayText } from "../i18n.ts";

/** Match either the original command wording or its localized display label. */
export function matchesCommandQuery(locale: InterfaceLocale, query: string, label: string, hint = ""): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const englishNeedle = trimmed.toLowerCase();
  const localizedNeedle = trimmed.toLocaleLowerCase(locale);
  return [label, hint].some((text) => text.toLowerCase().includes(englishNeedle)
    || displayText(locale, text).toLocaleLowerCase(locale).includes(localizedNeedle));
}
