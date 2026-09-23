// Bridge reads mouse batteries itself for its low-battery alerts, but it
// pauses those reads while this tab holds a HID session through it, so it
// never talks to a mouse mid-session. This hook fills that gap: while Bridge
// is this tab's HID transport, it forwards the battery the control panel is
// already reading, so alerts keep working with the panel open.
//
// The device id matches the "<brand>:<name>" id saved profiles use (see
// GameProfilePanel's deviceId), which is the id Bridge's own reads record
// under, so both sources update the same entry.
import { useEffect, useRef } from "react";
import { saveBridgeBattery, type BridgeBatteryReading } from "../bridge";
import { subscribeBridgeHidActive } from "../bridge-hid";
import type { ControlSnapshot } from "../device/types";

/** Resend an unchanged reading well inside Bridge's 12-minute staleness window. */
const REFRESH_INTERVAL_MS = 5 * 60_000;

function readingKey(reading: BridgeBatteryReading): string {
  return `${reading.deviceId}|${reading.percent}|${reading.charging}`;
}

export function useBridgeBatteryReporter(snapshot: ControlSnapshot): void {
  const { status } = snapshot;
  const reading: BridgeBatteryReading | null = status && status.batteryPercent != null
    ? {
      deviceId: `${status.brand}:${status.name}`,
      deviceName: status.name,
      percent: Math.round(status.batteryPercent),
      charging: status.batteryState.startsWith("Charging"),
    }
    : null;
  const readingRef = useRef(reading);
  readingRef.current = reading;
  const bridgeActive = useRef(false);
  const lastSent = useRef<{ key: string; at: number } | null>(null);

  const send = (force: boolean) => {
    const current = readingRef.current;
    if (!bridgeActive.current || !current) return;
    const key = readingKey(current);
    const previous = lastSent.current;
    if (!force && previous?.key === key && Date.now() - previous.at < REFRESH_INTERVAL_MS) return;
    lastSent.current = { key, at: Date.now() };
    // Alerts are best-effort; a missed report is retried on the next change or refresh.
    saveBridgeBattery(current).catch(() => undefined);
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => subscribeBridgeHidActive((active) => {
    bridgeActive.current = active;
    if (active) sendRef.current(true);
  }), []);

  useEffect(() => {
    const timer = setInterval(() => sendRef.current(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const key = reading ? readingKey(reading) : null;
  useEffect(() => {
    if (key) sendRef.current(false);
  }, [key]);
}
