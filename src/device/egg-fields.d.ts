import type {} from "@openmouse/protocol/drivers/mouse-types";

/**
 * Endgame Gear OP1-8K status fields the control panel reads. The protocol
 * package declares only the subset every EGG consumer shares; the rest of the
 * OP1 driver's status (its `EggOp1Status` extras) is declared here so the
 * panel can render the whole feature set without reaching into the driver.
 *
 * A window into a "v2" mouse (OP1/XM2 8K v2, OP1w/XM2w 4K v2, both behind the
 * 0x1970 dongle) adds the sensor controls; the v1 mice leave those undefined,
 * which is what `eggSupportsV2SensorControls` reports.
 */
declare module "@openmouse/protocol/drivers/mouse-types" {
  interface MouseStatus {
    /** CPI limits and the step the firmware accepts either side of 10,000 CPI. */
    eggCpiMin?: number;
    eggCpiMax?: number;
    eggCpiStepLow?: number;
    eggCpiStepHigh?: number;
    /** Index into `eggLodOptions`, the mouse's own lift-off list in millimetres. */
    eggLodIndex?: number;
    eggLodOptions?: string[];
    /** False on the 8K mice: Motion Sync and 8,000 Hz are mutually exclusive there. */
    eggMotionSyncAt8k?: boolean;
    /** Sensor angle tuning, a raw signed byte — v2 mice only. */
    eggAngleTuning?: number;
    /** v2 mice only. */
    eggForceMaxFps?: boolean;
    /** v2 mice only. */
    eggLedLiftOffDisabled?: boolean;
    eggSupportsV2SensorControls?: boolean;
    /** True when the buttons are swapped for left-hand use. */
    eggLeftHanded?: boolean;
  }
}
