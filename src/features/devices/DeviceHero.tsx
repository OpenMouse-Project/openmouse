import { displayText, t, tp, type I18nKey } from "../../i18n/index";
import { ChevronRight, ImageUp } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import * as control from "../../device/controller";
import { cachedBatterySamples, type BatterySample } from "./battery-history";
import type { ControlSnapshot, WorkspaceTab } from "../../device/types";
import { noirBrandLabel } from "../../device/noir.ts";
import { deviceImage, isUnknownDevice } from "../../shared/device-images";
import { DeviceStats } from "./DeviceStats";

const ARTWORK_DISCUSSION_URL =
  "https://github.com/OpenMouse-Project/openmouse/discussions/new?category=artwork-request";

export function DeviceHero({
  snapshot,
  tabs,
  activeTab,
  tabIcon,
}: {
  snapshot: ControlSnapshot;
  tabs: readonly WorkspaceTab[];
  activeTab: WorkspaceTab;
  tabIcon: (tab: WorkspaceTab) => ReactNode;
}): ReactNode {
  const locale = snapshot.preferences.locale;
  const status = snapshot.status;
  const keyboard = snapshot.keyboard;
  const [imageFailed, setImageFailed] = useState(false);
  const active = control.getActiveDevice();
  const activeEntry = snapshot.devices.find((device) => device.selected) ?? null;
  const name = status?.name ?? keyboard?.name ?? activeEntry?.name ?? "";
  const brand = status ? noirBrandLabel(status) : null;
  const image = snapshot.deviceArtwork
    ?? (keyboard ? deviceImage({ vendorId: keyboard.vendorId, productId: keyboard.productId } as HIDDevice, keyboard.name) : null);
  const needsArtwork = Boolean(status && active && (imageFailed || isUnknownDevice(
    { vendorId: active.vendorId, productId: active.productId } as HIDDevice,
    status.name,
  )));
  const artworkHref = `${ARTWORK_DISCUSSION_URL}${name ? `&title=${encodeURIComponent(`Artwork request: ${name}`)}` : ""}`;

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: WorkspaceTab): void => {
    const index = tabs.indexOf(current);
    const rtl = document.documentElement.dir === "rtl";
    let next: number;
    if (event.key === (rtl ? "ArrowLeft" : "ArrowRight")) next = (index + 1) % tabs.length;
    else if (event.key === (rtl ? "ArrowRight" : "ArrowLeft")) next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    control.setWorkspaceTab(tabs[next]!);
    document.querySelector<HTMLButtonElement>(`#workspace-tab-${tabs[next]}`)?.focus();
  };

  return (
    <header className="om-hero">
      <div className="om-hero-top">
        <div className="om-hero-stage">
          {image ? (
            <img
              src={image}
              alt={name}
              draggable={false}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = deviceImage(null);
                setImageFailed(true);
              }}
            />
          ) : null}
        </div>
        <div className="om-hero-main">
          <nav className="om-crumbs" aria-label={t(locale, "dev.breadcrumb")}>
            <button type="button" onClick={() => control.showDeviceList()}>{t(locale, "nav.devices")}</button>
            <ChevronRight strokeWidth={2} aria-hidden="true" />
            <span aria-current="page">{name}</span>
          </nav>
          <h1 className="om-hero-name">{name}</h1>
          <p className="om-hero-meta">
            <span className="om-dot is-ok" aria-hidden="true" />
            <span>{t(locale, "side.connected")}</span>
            {brand ? <><span className="om-sep" aria-hidden="true">·</span><span>{displayText(locale, brand)}</span></> : null}
            {status?.connectionDetail ? <><span className="om-sep" aria-hidden="true">·</span><span>{displayText(locale, status.connectionDetail)}</span></> : null}
            {activeEntry?.transport === "bridge" ? <><span className="om-sep" aria-hidden="true">·</span><span>{t(locale, "bridge.title")}</span></> : null}
          </p>
          {status ? <DeviceStats status={status} locale={locale} transport={activeEntry?.transport} full /> : null}
        </div>
        {needsArtwork ? (
          <div className="om-hero-actions">
            <a className="om-btn is-ghost is-sm" href={artworkHref} target="_blank" rel="noopener noreferrer">
              <ImageUp strokeWidth={1.9} aria-hidden="true" />
              {t(locale, "artreq.request" as I18nKey)}
            </a>
          </div>
        ) : null}
      </div>
      {tabs.length > 1 ? (
        <nav className="om-tabs" role="tablist" aria-label={t(locale, "panel.deviceSections")}>
          {tabs.map((tab) => (
            <button
              key={tab}
              id={`workspace-tab-${tab}`}
              type="button"
              role="tab"
              className={`om-tab${activeTab === tab ? " is-active" : ""}`}
              aria-selected={activeTab === tab}
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => control.setWorkspaceTab(tab)}
              onKeyDown={(event) => onTabKey(event, tab)}
            >
              {tabIcon(tab)}
              <span>{t(locale, `tab.${tab}` as I18nKey)}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

export function CurrentSetupPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const stages = Array.isArray(status.dpiStages) ? status.dpiStages.filter((value) => value > 0) : [];
  const activeStage = typeof status.activeDpiStage === "number" ? status.activeDpiStage : -1;
  const maxRate = status.supportedPollingRates?.length ? Math.max(...status.supportedPollingRates) : null;
  const figures: Array<{ key: string; label: string; value: string; unit?: string; sub?: string }> = [];
  if (status.dpi > 0) {
    figures.push({
      key: "dpi",
      label: t(locale, "ov.sensitivity"),
      value: status.dpi.toLocaleString(),
      unit: "DPI",
      sub: stages.length > 1 && activeStage >= 0 ? tp(locale, "ov.stageOf", { n: activeStage + 1, total: stages.length }) : undefined,
    });
  }
  if (status.pollingRateHz > 0) {
    figures.push({
      key: "poll",
      label: t(locale, "ov.pollingRate"),
      value: status.pollingRateHz.toLocaleString(),
      unit: "Hz",
      sub: maxRate && maxRate > status.pollingRateHz ? tp(locale, "ov.upTo", { v: `${maxRate.toLocaleString()} Hz` }) : undefined,
    });
  }
  if (status.batteryPercent !== null) {
    figures.push({
      key: "battery",
      label: t(locale, "ov.batteryLabel"),
      value: String(status.batteryPercent),
      unit: "%",
      sub: displayText(locale, status.batteryState),
    });
  }
  if (status.activeProfile != null) {
    figures.push({ key: "profile", label: t(locale, "ov.onboardProfile"), value: String(status.activeProfile) });
  }
  if (figures.length === 0) return null;
  return (
    <section className="om-panel is-lit om-setup" aria-labelledby="om-setup-title">
      <header className="om-panel-head">
        <h2 id="om-setup-title">{t(locale, "ov.setupTitle")}</h2>
        <span className="om-meta">{t(locale, "ov.setupMeta")}</span>
      </header>
      <div className="om-setup-figures" style={{ "--cols": String(figures.length) }}>
        {figures.map((figure) => (
          <div key={figure.key} className="om-setup-figure">
            <span className="om-label">{figure.label}</span>
            <span className="om-fig">{figure.value}{figure.unit ? <span className="om-unit">{figure.unit}</span> : null}</span>
            {figure.sub ? <span className="om-meta">{figure.sub}</span> : null}
          </div>
        ))}
      </div>
      {stages.length > 1 ? (
        <div className="om-setup-stages">
          <span className="om-label">{t(locale, "ov.stages")}</span>
          <div className="om-setup-stage-list">
            {stages.map((value, index) => (
              <span key={index} className={`om-chip${index === activeStage ? " is-on" : ""}`} aria-current={index === activeStage ? "true" : undefined}>
                {value.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function sparkPath(samples: readonly BatterySample[], width: number, height: number): { line: string; area: string; start: number; end: number } | null {
  if (samples.length < 2) return null;
  const start = samples[0]!.timestamp;
  const end = samples[samples.length - 1]!.timestamp;
  const span = Math.max(1, end - start);
  const x = (time: number): number => ((time - start) / span) * width;
  const y = (percent: number): number => height - (Math.max(0, Math.min(100, percent)) / 100) * height;
  const points = samples.map((sample) => `${x(sample.timestamp).toFixed(1)},${y(sample.percent).toFixed(1)}`);
  const line = `M${points.join(" L")}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area, start, end };
}

export function BatteryHistoryPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;
  const samples = useMemo(() => {
    if (!status || status.batteryPercent === null) return [];
    try {
      const now = Date.now();
      return cachedBatterySamples(window.localStorage, status.name, now).filter((sample) => sample.timestamp >= now - 7 * DAY_MS);
    } catch {
      return [];
    }
  }, [status?.name, status?.batteryPercent]);
  if (!status || status.batteryPercent === null) return null;
  const width = 600;
  const height = 120;
  const path = sparkPath(samples, width, height);
  const estimate = control.batteryEstimateParts(status, locale);
  const format = new Intl.DateTimeFormat(locale, { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <section className="om-panel om-battery" aria-labelledby="om-battery-title">
      <header className="om-panel-head">
        <h2 id="om-battery-title">{t(locale, "ov.historyTitle")}</h2>
        <span className="om-meta">{t(locale, "ov.historyMeta")}</span>
        {estimate ? (
          <span className="om-end">
            <span className="om-fig is-sm">{displayText(locale, estimate.time)}</span>
            <span className="om-meta">{displayText(locale, estimate.label)}</span>
          </span>
        ) : null}
      </header>
      {path ? (
        <figure className="om-battery-chart">
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={t(locale, "ov.historyTitle")}>
            <line className="om-chart-guide" x1="0" x2={width} y1={height / 2} y2={height / 2} />
            <line className="om-chart-guide" x1="0" x2={width} y1={height * 0.8} y2={height * 0.8} />
            <path className="om-chart-area" d={path.area} />
            <path className="om-chart-line" d={path.line} vectorEffect="non-scaling-stroke" />
          </svg>
          <figcaption className="om-battery-axis">
            <span>{format.format(path.start)}</span>
            <span>{format.format(path.end)}</span>
          </figcaption>
        </figure>
      ) : (
        <div className="om-empty">
          <strong>{t(locale, "ov.historyEmpty")}</strong>
          <p>{t(locale, "ov.historyEmptyBody")}</p>
        </div>
      )}
    </section>
  );
}
