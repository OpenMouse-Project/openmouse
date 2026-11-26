import { createContext, useContext } from "react";
import { detectLocale, loadInterfacePreferences, type InterfaceLocale } from "../features/settings/interface-preferences";

/** Display locale is inherited; device commands and stored profile data stay untouched. */
export const UiLocaleContext = createContext<InterfaceLocale | null>(null);

export function initialUiLocale(): InterfaceLocale {
  try {
    return loadInterfacePreferences(window.localStorage).locale;
  } catch {
    return detectLocale();
  }
}

export function useUiLocale(): InterfaceLocale {
  return useContext(UiLocaleContext) ?? initialUiLocale();
}
