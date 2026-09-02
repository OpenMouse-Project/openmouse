/* Public launch gate. OpenMouse Early Access (Beta 1.0) opens at 11:00 AM
   Mountain time (MDT, UTC-6 — daylight saving is in effect in September) on
   Friday September 4th 2026 — 17:00 UTC. Before that moment the control app
   is replaced by a countdown page; after it, the app renders normally.

   Swap the timestamp for the next milestone (or set it to now to lift the
   gate) once the beta is live. */

const LAUNCH_AT = Date.UTC(2026, 8, 4, 17, 0, 0);

export const LAUNCH_TIME = LAUNCH_AT;

export function isBeforeLaunch(now: number = Date.now()): boolean {
  return now < LAUNCH_TIME;
}

export function millisecondsUntilLaunch(now: number = Date.now()): number {
  return Math.max(0, LAUNCH_TIME - now);
}

export function launchDateTimeLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(new Date(LAUNCH_TIME));
}
