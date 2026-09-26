import type {} from "@openmouse/protocol/drivers/mouse-types";

declare module "@openmouse/protocol/drivers/mouse-types" {
  interface MouseStatus {
    atkSensorMode?: number | null;
    atkAntiMistouchMs?: number | null;
    atkDongleLight?: number | null;
  }
}
