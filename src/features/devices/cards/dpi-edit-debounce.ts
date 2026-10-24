export interface EditTimers {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

const globalTimers: EditTimers = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Holds at most one pending DPI editor commit. A newer schedule replaces the
 * pending one, and anything applied immediately (a preset pick) must cancel it
 * first so the older rows captured by the timer cannot land on top of it.
 */
export interface DpiEditDebouncer {
  /** Run `run` after `delay` ms, dropping any commit still pending. */
  schedule(run: () => void, delay: number): void;
  /** Drop the pending commit without running it. Returns whether one was pending. */
  cancel(): boolean;
  pending(): boolean;
}

export function createDpiEditDebouncer(timers: EditTimers = globalTimers): DpiEditDebouncer {
  let handle: unknown = null;
  let scheduled = false;

  const cancel = (): boolean => {
    if (!scheduled) return false;
    timers.clearTimeout(handle);
    handle = null;
    scheduled = false;
    return true;
  };

  return {
    schedule(run, delay) {
      cancel();
      scheduled = true;
      handle = timers.setTimeout(() => {
        handle = null;
        scheduled = false;
        run();
      }, delay);
    },
    cancel,
    pending: () => scheduled,
  };
}
