import { displayText } from "../i18n";
import { useUiLocale } from "./ui-locale";
import type { ReactNode } from "react";
import type { UnsupportedNotice as Notice } from "../browser-support";

export function UnsupportedNotice({ notice }: { notice: Notice }): ReactNode {
  const __uiLocale = useUiLocale();
  return (
    <section className="small-screen-blocker">
      <h1>{displayText(__uiLocale, notice.headline)}</h1>
      <p>{displayText(__uiLocale, notice.detail)}</p>
    </section>
  );
}
