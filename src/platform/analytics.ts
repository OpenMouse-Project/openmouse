type PosthogClient = typeof import("posthog-js/dist/module.no-external")["default"];

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;

// posthog-js is the single heaviest dependency (measured ~377 kB minified),
// and it only matters once something worth counting happens. It loads in the
// background; events and exceptions raised before it arrives are queued and
// replayed, so the split changes when data starts flowing, never whether.
let posthog: PosthogClient | null = null;

// Analytics must never take the app down: a failed init just leaves it silent.
let initialised = false;

const ANALYTICS_READY_EVENT = "openmouse-analytics-ready";

type QueuedEvent =
  | { kind: "event"; event: string; props?: Record<string, unknown> }
  | { kind: "error"; error: unknown };

// The queue only bridges the gap until the lazy client arrives: bounded and
// drop-oldest so a slow network can never grow memory without limit.
const MAX_QUEUE = 50;
const queue: QueuedEvent[] = [];


// Error hooks install once the client is ready (or the moment a first event is
// queued, so early failures are captured) — never before opt-out is known, so
// a persisted opt-out leaves no listeners and no queue behind.
let errorHooksInstalled = false;

function installErrorHooks(): void {
  if (errorHooksInstalled) return;
  errorHooksInstalled = true;
  window.addEventListener("error", (event) => {
    forwardError(event.error ?? new Error(event.message));
  });
  window.addEventListener("unhandledrejection", (event) => {
    forwardError(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
  });
}

if (posthogKey && posthogHost) {
  void boot();
} else {
  // Without both variables (local dev, forks, previews) analytics is a no-op.
}

async function boot(): Promise<void> {
  try {
    const { default: client } = await import("posthog-js/dist/module.no-external");
    client.init(posthogKey!, {
      api_host: posthogHost!,
      defaults: "2026-05-30",
      // Anonymous random id in localStorage only: counts users and return visits.
      persistence: "localStorage",
      ip: false,
      respect_dnt: true,
      autocapture: false,
      disable_session_recording: true,
      person_profiles: "identified_only",
      // The bundled build ships no error wrappers, and the lazy-loaded ones would
      // be blocked by Trusted Types, so uncaught errors are forwarded below.
      capture_exceptions: false,
      before_send: scrubExceptionEvent,
    });
    posthog = client;
    initialised = true;
    // Hooks only attach once the client exists, so has_opted_out_capturing()
    // is meaningful; flushQueue drops the backlog when opted out.
    if (!client.has_opted_out_capturing()) installErrorHooks();
    flushQueue();
    try {
      window.dispatchEvent(new Event(ANALYTICS_READY_EVENT));
    } catch {
    }
  } catch {
    /* analytics is optional */
  }
}

function enqueue(item: QueuedEvent): void {
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(item);
}

function forwardError(error: unknown): void {
  if (initialised && posthog && !posthog.has_opted_out_capturing()) {
    posthog.captureException(error instanceof Error ? error : new Error(String(error)));
  } else if (!initialised && posthogKey && posthogHost) {
    installErrorHooks();
    enqueue({ kind: "error", error });
  }
}

function flushQueue(): void {
  // The queued events predate any consent signal; a pre-existing opt-out
  // (persisted from an earlier visit) must still be honoured, so the whole
  // backlog is dropped instead of replayed.
  if (posthog?.has_opted_out_capturing()) {
    queue.length = 0;
    return;
  }
  for (const item of queue.splice(0)) {
    if (item.kind === "event") posthog?.capture(item.event, item.props);
    else forwardError(item.error);
  }
}

function trackInternal(event: string, props?: Record<string, unknown>): void {
  if (initialised) posthog?.capture(event, props);
  else if (posthogKey && posthogHost) {
    installErrorHooks();
    enqueue({ kind: "event", event, props });
  }
}

/** Whether anonymous diagnostics are being sent (on unless the user opted out). */
export function analyticsEnabled(): boolean {
  return initialised && posthog ? !posthog.has_opted_out_capturing() : false;
}

export function setAnalyticsEnabled(enabled: boolean): void {
  if (!initialised || !posthog) return;
  if (enabled) posthog.opt_in_capturing();
  else posthog.opt_out_capturing();
}

/** Whether this build reports anything, so Settings can hide a dead switch. */
export function analyticsAvailable(): boolean {
  return initialised;
}
export { ANALYTICS_READY_EVENT };

/** Numeric/vendor device facts only: never serials, receiver ids or free-text names. */
export interface DeviceFacts {
  vendorId?: number;
  productId?: number;
  vendor?: string;
  brand?: string;
}

export function deviceProps(device: DeviceFacts | null | undefined): Record<string, string | number> {
  const props: Record<string, string | number> = {};
  if (!device) return props;
  if (device.vendorId !== undefined) props.vendor_id = device.vendorId;
  if (device.productId !== undefined) props.product_id = device.productId;
  if (device.vendor) props.vendor = device.vendor.slice(0, 40);
  if (device.brand) props.brand = device.brand.slice(0, 40);
  return props;
}

/** Text with emails, paths and long hex ids (serials, receiver ids) removed, and capped. */
function scrubText(raw: string): string {
  return raw
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>")
    .replace(/(?:[A-Za-z]:)?[\\/][\w .\\/-]{3,}/g, "<path>")
    .replace(/\b[0-9a-fA-F]{12,}\b/g, "<id>")
    .slice(0, 200);
}

export function scrubError(error: unknown): { error_name: string; error_message: string } {
  const name = error instanceof Error ? error.name : "Error";
  return { error_name: name, error_message: scrubText(error instanceof Error ? error.message : String(error)) };
}

interface ExceptionFrame { filename?: string; abs_path?: string; [key: string]: unknown }
interface ExceptionEntry { type?: string; value?: string; stacktrace?: { frames?: ExceptionFrame[] }; [key: string]: unknown }
interface OutgoingEvent { event: string; properties?: Record<string, unknown> }

/** Frame files stay only when they are the app's own bundles, so stacks still de-minify. */
function ownFile(file: string | undefined): string | undefined {
  return file && file.startsWith(location.origin) ? file.split(/[?#]/)[0] : undefined;
}

/** Scrubs automatic `$exception` events before they leave the browser. */
function scrubExceptionEvent<T extends OutgoingEvent | null>(event: T): T {
  if (!event || event.event !== "$exception" || !event.properties) return event;
  const props = event.properties;
  const list = props.$exception_list;
  if (Array.isArray(list)) {
    props.$exception_list = (list as ExceptionEntry[]).map((entry) => ({
      ...entry,
      value: typeof entry.value === "string" ? scrubText(entry.value) : entry.value,
      stacktrace: entry.stacktrace
        ? {
            ...entry.stacktrace,
            frames: entry.stacktrace.frames?.map((frame) => ({
              ...frame,
              filename: ownFile(frame.filename),
              abs_path: ownFile(frame.abs_path),
            })),
          }
        : entry.stacktrace,
    }));
  }
  for (const key of ["$exception_message", "$exception_value"]) {
    if (typeof props[key] === "string") props[key] = scrubText(props[key] as string);
  }
  return event;
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (initialised) {
    if (!posthog?.has_opted_out_capturing()) posthog?.capture(event, props);
    return;
  }
  if (posthogKey && posthogHost) trackInternal(event, props);
}
