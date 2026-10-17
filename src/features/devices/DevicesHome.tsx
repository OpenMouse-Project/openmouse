import { displayText, t, tp } from "../../i18n/index";
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import * as control from "../../device/controller";
import type { ControlSnapshot, SidebarDevice } from "../../device/types";
import { deviceImage, deviceImageFilename, showcaseDeviceImageUrls } from "../../shared/device-images";
import { DeviceStats } from "./DeviceStats";

const SHOWCASE_IMAGES = showcaseDeviceImageUrls();
const SHOWCASE_INTERVAL_MS = 3800;

function MouseArtworkShowcase({ reducedMotion }: { reducedMotion: boolean }): ReactNode {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reducedMotion || SHOWCASE_IMAGES.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % SHOWCASE_IMAGES.length);
    }, SHOWCASE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion]);
  return (
    <div className="om-showcase" aria-hidden="true">
      {SHOWCASE_IMAGES.map((src, i) => (
        <img key={src} src={src} alt="" draggable={false} className={i === index ? "is-active" : ""} />
      ))}
    </div>
  );
}

function useConnect(snapshot: ControlSnapshot): { busy: boolean; disabled: boolean; run: () => void } {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    disabled: busy || snapshot.connectDisabled,
    run: () => {
      if (busy) return;
      setBusy(true);
      void control.connect().finally(() => setBusy(false));
    },
  };
}

function DeviceArt({ device }: { device: SidebarDevice }): ReactNode {
  const src = deviceImage({ vendorId: device.vendorId, productId: device.productId } as HIDDevice, device.name);
  const file = deviceImageFilename(device.name);
  const portrait = file === "noir-m2-nex.png" || file === "noir-s1.png" || file === "noir-e1.png";
  return (
    <img
      className={`om-device-render${portrait ? " is-portrait" : ""}`}
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = deviceImage(null);
      }}
    />
  );
}

function DeviceMenu({ snapshot, device }: { snapshot: ControlSnapshot; device: SidebarDevice }): ReactNode {
  const locale = snapshot.preferences.locale;
  const [mode, setMode] = useState<"closed" | "menu" | "confirm">("closed");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mode === "closed") return;
    const away = (event: MouseEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setMode("closed");
    };
    const key = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMode("closed");
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [mode]);

  const remove = (): void => {
    setBusy(true);
    void control.removeAuthorizedDevice(device.index).finally(() => {
      setBusy(false);
      setMode("closed");
    });
  };

  return (
    <div className="om-device-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="om-icon-btn om-device-menu-trigger"
        aria-label={t(locale, "home.actions")}
        aria-haspopup="menu"
        aria-expanded={mode !== "closed"}
        onClick={() => setMode((current) => (current === "closed" ? "menu" : "closed"))}
      >
        <MoreHorizontal strokeWidth={2} aria-hidden="true" />
      </button>
      {mode === "menu" ? (
        <div className="om-device-menu-pop" role="menu">
          <button type="button" role="menuitem" className="om-device-menu-item" onClick={() => void control.openDeviceOverview(device.index)}>
            <Settings2 strokeWidth={1.8} aria-hidden="true" />
            {t(locale, "home.configure")}
          </button>
          <button type="button" role="menuitem" className="om-device-menu-item is-danger" onClick={() => setMode("confirm")}>
            <Trash2 strokeWidth={1.8} aria-hidden="true" />
            {t(locale, "home.remove")}
          </button>
        </div>
      ) : null}
      {mode === "confirm" ? (
        <div className="om-device-menu-pop is-confirm" role="alertdialog" aria-labelledby={`om-remove-${device.index}`}>
          <strong id={`om-remove-${device.index}`}>{tp(locale, "home.removeTitle", { name: device.name })}</strong>
          <p>{t(locale, "home.removeBody")}</p>
          <div className="om-device-menu-actions">
            <button type="button" className="om-btn is-ghost" onClick={() => setMode("closed")}>{t(locale, "common.cancel")}</button>
            <button type="button" className="om-btn is-danger-solid" disabled={busy} onClick={remove}>
              <Trash2 strokeWidth={1.9} aria-hidden="true" />
              {t(locale, "home.remove")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeviceBlock({ snapshot, device }: { snapshot: ControlSnapshot; device: SidebarDevice }): ReactNode {
  const locale = snapshot.preferences.locale;
  const live = device.selected && (snapshot.deviceStatus !== null || snapshot.keyboard !== null);
  const status = live ? snapshot.deviceStatus : null;
  const brand = status?.brand ?? null;
  const open = (): void => void control.openDeviceOverview(device.index);
  return (
    <article className={`om-device-block${live ? " is-live" : ""}`}>
      <button
        type="button"
        className="om-device-block-hit"
        onClick={open}
        aria-label={displayText(locale, `${device.name}. ${t(locale, live ? "home.configure" : "home.open")}`)}
      />
      <header className="om-device-block-top">
        <span className="om-device-block-name">{device.name}</span>
        {live ? (
          <span className="om-badge is-ok"><span className="om-dot is-ok" />{t(locale, "side.connected")}</span>
        ) : (
          <span className="om-badge">{t(locale, "home.notConnected")}</span>
        )}
        <DeviceMenu snapshot={snapshot} device={device} />
      </header>
      <span className="om-device-block-meta">
        {[brand, device.kind === "keyboard" ? t(locale, "home.keyboard") : t(locale, "home.mouse"), device.transport === "bridge" ? t(locale, "bridge.title") : null]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {status ? (
        <DeviceStats status={status} locale={locale} transport={device.transport} />
      ) : (
        <span className="om-stats"><span className="om-stat om-muted">{t(locale, "home.openHint")}</span></span>
      )}
      <span className="om-device-block-art">
        <DeviceArt device={device} />
      </span>
      <span className={`om-btn${live ? " is-primary" : ""} om-device-block-action`} aria-hidden="true">
        {t(locale, live ? "home.configure" : "home.open")}
      </span>
    </article>
  );
}

function AddDeviceBlock({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const connect = useConnect(snapshot);
  return (
    <article className="om-device-block is-add">
      <header className="om-device-block-top">
        <span className="om-device-block-name">{t(locale, "conn.add")}</span>
      </header>
      <span className="om-device-block-meta">{t(locale, "empty.body")}</span>
      <span className="om-device-block-art">
        <MouseArtworkShowcase reducedMotion={snapshot.preferences.reducedMotion} />
      </span>
      <button
        type="button"
        className={`om-btn${snapshot.devices.length === 0 ? " is-primary" : ""} om-device-block-action`}
        disabled={connect.disabled}
        onClick={connect.run}
      >
        <Plus strokeWidth={2} aria-hidden="true" />
        {connect.busy ? t(locale, "conn.connecting") : t(locale, "conn.add")}
      </button>
    </article>
  );
}

function DeviceShelf({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const track = useRef<HTMLUListElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [state, setState] = useState({ index: 0, overflow: false, start: true, end: true });
  const devices = snapshot.devices;
  const count = devices.length + 1;
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  const measure = useCallback(() => {
    const element = track.current;
    if (!element) return;
    const first = element.firstElementChild as HTMLElement | null;
    const step = first ? first.offsetWidth + 16 : element.clientWidth;
    const left = Math.abs(element.scrollLeft);
    const max = element.scrollWidth - element.clientWidth;
    setState({
      index: Math.min(count - 1, Math.round(left / Math.max(1, step))),
      overflow: max > 4,
      start: left <= 4,
      end: left >= max - 4,
    });
  }, [count]);

  useEffect(() => {
    measure();
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const live = element.querySelector<HTMLElement>(".om-device-block.is-live");
    if (live && element.scrollWidth > element.clientWidth) {
      live.parentElement?.scrollIntoView({ block: "nearest", inline: "start", behavior: "auto" });
    } else {
      element.scrollTo({ left: 0, behavior: "auto" });
    }
  }, [count]);

  const scrollToIndex = (index: number): void => {
    const element = track.current;
    const item = element?.children[index] as HTMLElement | undefined;
    if (!element || !item) return;
    item.scrollIntoView({ block: "nearest", inline: "start", behavior: snapshot.preferences.reducedMotion ? "auto" : "smooth" });
  };

  const step = (direction: 1 | -1): void => {
    scrollToIndex(Math.max(0, Math.min(count - 1, state.index + direction)));
  };

  const onPointerDown = (event: PointerEvent<HTMLUListElement>): void => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !track.current) return;
    if ((event.target as HTMLElement).closest(".om-device-menu")) return;
    drag.current = { x: event.clientX, left: track.current.scrollLeft, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLUListElement>): void => {
    const element = track.current;
    const current = drag.current;
    if (!element || !current) return;
    const dx = event.clientX - current.x;
    if (!current.moved && Math.abs(dx) < 6) return;
    if (!current.moved) {
      current.moved = true;
      element.setPointerCapture(event.pointerId);
      element.classList.add("is-dragging");
    }
    element.scrollLeft = current.left - dx;
  };
  const endDrag = (event: PointerEvent<HTMLUListElement>): void => {
    const element = track.current;
    const current = drag.current;
    drag.current = null;
    if (!element || !current?.moved) return;
    element.releasePointerCapture(event.pointerId);
    element.classList.remove("is-dragging");
    const swallow = (click: MouseEvent): void => { click.stopPropagation(); click.preventDefault(); };
    element.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => element.removeEventListener("click", swallow, { capture: true }), 0);
    measure();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const items = Array.from(track.current?.querySelectorAll<HTMLElement>(".om-device-block-hit, .om-device-block.is-add .om-device-block-action") ?? []);
    const index = items.findIndex((node) => node === document.activeElement || node.contains(document.activeElement));
    if (index === -1) return;
    const forward = (event.key === "ArrowRight") !== rtl;
    const next = items[Math.max(0, Math.min(items.length - 1, index + (forward ? 1 : -1)))];
    if (next) {
      event.preventDefault();
      next.focus();
      next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: snapshot.preferences.reducedMotion ? "auto" : "smooth" });
    }
  };

  return (
    <section className="om-shelf" aria-labelledby="om-shelf-title">
      <div className="om-shelf-head">
        <h2 id="om-shelf-title" className="sr-only">{t(locale, "nav.yourDevices")}</h2>
        {state.overflow ? (
          <div className="om-shelf-nav">
            <button type="button" className="om-btn is-icon" aria-label={t(locale, "home.prev")} disabled={state.start} onClick={() => step(rtl ? 1 : -1)}>
              <ChevronLeft strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className="om-btn is-icon" aria-label={t(locale, "home.next")} disabled={state.end} onClick={() => step(rtl ? -1 : 1)}>
              <ChevronRight strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
      <ul
        ref={track}
        className="om-shelf-track"
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        {devices.map((device) => (
          <li key={device.index} className="om-shelf-item">
            <DeviceBlock snapshot={snapshot} device={device} />
          </li>
        ))}
        <li className="om-shelf-item">
          <AddDeviceBlock snapshot={snapshot} />
        </li>
      </ul>
      {state.overflow ? (
        <div className="om-shelf-dots" role="group" aria-label={t(locale, "nav.yourDevices")}>
          {[...devices.map((device) => device.name), t(locale, "conn.add")].map((name, index) => (
            <button
              key={`${name}-${index}`}
              type="button"
              className={index === state.index ? "is-active" : ""}
              aria-label={name}
              aria-current={index === state.index ? "true" : undefined}
              onClick={() => scrollToIndex(index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function DevicesHome({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const hasDevices = snapshot.devices.length > 0;
  return (
    <div className={`om-page om-home${hasDevices ? "" : " is-empty"}`}>
      <header className="om-page-head">
        <div>
          <h1>{t(locale, "nav.devices")}</h1>
          <p className="om-meta">{t(locale, hasDevices ? "home.subtitle" : "empty.title")}</p>
        </div>
      </header>
      <DeviceShelf snapshot={snapshot} />
    </div>
  );
}
