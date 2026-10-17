import { displayText } from "../i18n/index";
import { useUiLocale } from "../shared/ui-locale";
import type { ReactNode } from "react";
import type { UnsupportedNotice as Notice } from "../platform/browser-support";

export function UnsupportedNotice({ notice }: { notice: Notice }): ReactNode {
  const __uiLocale = useUiLocale();
  return (
    <section className="small-screen-blocker">
      <img className="standalone-brand" src="/logo.png" alt="" width={28} height={42} />
      <h1>{displayText(__uiLocale, notice.headline)}</h1>
      <p>{displayText(__uiLocale, notice.detail)}</p>
    </section>
  );
}
