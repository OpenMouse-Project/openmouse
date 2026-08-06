import type { EnrollDeviceMessage, StatusMessage } from "./types";

const PORT = 47823;
const TOKEN_KEY = "openmouse-companion-token-v1";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "denied";

export interface GameModeClientEvents {
  onStateChange?(state: ConnectionState): void;
  onStatus?(status: StatusMessage): void;
  onEnrollResult?(ok: boolean, deviceKey: string, error?: string): void;
}

/**
 * Talks to OpenMouseCompanion over ws://127.0.0.1 — a loopback target, so
 * browsers exempt it from the mixed-content block that would otherwise stop
 * an https:// page from opening a plain ws:// connection. Reconnects with
 * backoff on its own, EXCEPT after an explicit pairDenied: retrying that
 * automatically would re-trigger the tray Allow/Block popup on a timer and
 * spam the user. Call connect() again (e.g. from a "Retry" button) to try
 * once more after a denial.
 */
export class GameModeClient {
  private socket: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectDelayMs = 1000;
  private reconnectTimer: number | null = null;
  private stopped = false;

  constructor(private readonly events: GameModeClientEvents) {}

  connect(): void {
    this.stopped = false;
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  enrollDevice(message: EnrollDeviceMessage): void {
    this.send(message);
  }

  setGameModeEnabled(deviceKey: string, enabled: boolean): void {
    this.send({ type: "setGameModeEnabled", deviceKey, enabled });
  }

  removeDevice(deviceKey: string): void {
    this.send({ type: "removeDevice", deviceKey });
  }

  private open(): void {
    this.setState("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectDelayMs = 1000;
      this.send({ type: "hello", token: localStorage.getItem(TOKEN_KEY) ?? undefined, clientVersion: "1" });
    });

    socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));

    socket.addEventListener("close", () => {
      this.socket = null;
      if (this.state !== "denied") this.setState("disconnected");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      try { socket.close(); } catch { /* already closing */ }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = window.setTimeout(() => this.open(), this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15000);
  }

  private handleMessage(raw: string): void {
    let message: Record<string, unknown>;
    try { message = JSON.parse(raw) as Record<string, unknown>; }
    catch { return; }

    switch (message.type) {
      case "paired":
        if (typeof message.token === "string") localStorage.setItem(TOKEN_KEY, message.token);
        this.setState("connected");
        break;
      case "pairDenied":
        localStorage.removeItem(TOKEN_KEY);
        this.stopped = true; // don't auto-retry a denial — see class doc
        this.setState("denied");
        break;
      case "status":
        this.setState("connected");
        this.events.onStatus?.(message as unknown as StatusMessage);
        break;
      case "enrollResult":
        this.events.onEnrollResult?.(Boolean(message.ok), String(message.deviceKey ?? ""), message.error as string | undefined);
        break;
    }
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onStateChange?.(state);
  }
}
