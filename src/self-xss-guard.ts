/**
 * Self-XSS deterrence for the deployed app.
 *
 * A web page cannot stop someone from running code in their own developer
 * tools — the browser exposes no such control — so this is deterrence, not a
 * security boundary. It prints the familiar "do not paste code here" banner
 * to the console.
 *
 * It deliberately avoids `debugger` loops, console overrides and detecting
 * open developer tools: those are trivially bypassed, break legitimate
 * debugging, and misfire on browsers with wide chrome (e.g. Firefox forks
 * with vertical tabs or sidebars).
 *
 * Call only on production builds (see control.tsx).
 */

const WARNING_TITLE = "Stop!";
const WARNING_BODY =
  "This console is meant for developers. If someone told you to copy and paste " +
  "code here, it is a scam: pasting it can hand over your connected mouse and " +
  "your OpenMouse settings. Never paste code you do not fully understand.";

/** Prints the production-only console warning. Call once. */
export function startSelfXssGuard(): void {
  console.log(
    `%c${WARNING_TITLE}`,
    "color:#fff;background:#b3261e;font-size:24px;font-weight:800;padding:6px 14px;border-radius:6px;",
  );
  console.log(`%c${WARNING_BODY}`, "color:inherit;font-size:15px;line-height:1.5;");
}
