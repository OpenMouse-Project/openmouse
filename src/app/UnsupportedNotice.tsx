import type { ReactNode } from "react";
import type { UnsupportedNotice as Notice } from "../browser-support";

export function UnsupportedNotice({ notice }: { notice: Notice }): ReactNode {
  return (
    <section className="small-screen-blocker">
      <h1>{notice.headline}</h1>
      <p>{notice.detail}</p>
    </section>
  );
}
