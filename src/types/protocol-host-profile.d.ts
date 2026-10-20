// Fields the Host profile and game profile work puts on `MouseStatus` that
// @openmouse/protocol 0.46.0 does not have yet (OpenMouse-Project/mouse-protocol#246).
// They merge into the package's own declaration, and the same fields in a later
// release are identical, so this file can simply be deleted once the pin is bumped.
import "@openmouse/protocol/drivers/mouse-types";

declare module "@openmouse/protocol/drivers/mouse-types" {
  interface MouseStatus {
    hostBunnyHopMs?: number;
    hostButtons?: Record<number, { key: number; modifiers: number } | { consumer: number }>;
    pollingRateWirelessHz?: number;
    pollingRateWiredHz?: number;
  }
}
