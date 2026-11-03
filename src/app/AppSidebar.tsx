import { DISCORD_URL, DiscordIcon } from "../shared/social-links";
import { displayText, t } from "../i18n/index";
import {
  Activity,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  LayoutGrid,
  Megaphone,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, type ReactNode } from "react";
import type { ControlSnapshot, SidebarDevice } from "../device/types";
import type { InterfaceLocale } from "../features/settings/interface-preferences";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { deviceImage } from "../shared/device-images";
import { BridgeStatusButton } from "../features/bridge/BridgeStatus";
import { BatteryIcon } from "../shared/ui";

export const OPENMOUSE_URL = "https://openmouse.app/";

export type DesktopPage = "home" | "dashboard" | "hardware-test" | "games" | "settings";

const NavItem = memo(function NavItem({
  icon: Icon,
  label,
  active = false,
  external = false,
  href,
  onClick,
  collapsed,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  external?: boolean;
  href?: string;
  onClick?: () => void;
  collapsed: boolean;
}): ReactNode {
  const body = (
    <>
      <Icon className="om-nav-icon" strokeWidth={1.8} aria-hidden="true" />
      <span className="om-nav-label">{label}</span>
      {external ? <span className="om-nav-ext" aria-hidden="true">↗</span> : null}
    </>
  );
  const className = `om-nav-item${active ? " is-active" : ""}`;
  const title = collapsed ? label : undefined;
  if (href) {
    return (
      <a className={className} title={title} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
        {body}
      </a>
    );
  }
  return (
    <button className={className} title={title} aria-current={active ? "page" : undefined} type="button" onClick={onClick}>
      {body}
    </button>
  );
});

const SidebarDeviceRow = memo(function SidebarDeviceRow({
  locale,
  device,
  live,
  batteryPercent,
  batteryState,
  collapsed,
  open,
}: {
  locale: InterfaceLocale;
  device: SidebarDevice;
  live: boolean;
  batteryPercent: number | null;
  batteryState: MouseStatus["batteryState"];
  collapsed: boolean;
  open: (index: number) => void;
}): ReactNode {
  const image = deviceImage({ vendorId: device.vendorId, productId: device.productId } as HIDDevice, device.name);
  const openDevice = useCallback(() => open(device.index), [open, device.index]);
  return (
    <li>
      <button
        type="button"
        className={`om-side-device${live ? " is-active" : ""}`}
        title={collapsed ? device.name : undefined}
        onClick={openDevice}
      >
        <span className="om-side-device-art" aria-hidden="true">
          <img
            src={image}
            alt=""
            loading="lazy"
            draggable={false}
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = deviceImage(null);
            }}
          />
          {live ? <span className="om-side-device-live" /> : null}
        </span>
        <span className="om-side-device-text">
          <span className="om-side-device-name">{device.name}</span>
          <span className="om-side-device-sub">
            {batteryPercent != null ? (
              <>
                <BatteryIcon percent={batteryPercent} state={batteryState} />
                <span>{batteryPercent}%</span>
              </>
            ) : (
              <span>{live ? t(locale, "side.connected") : t(locale, "home.notConnected")}</span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
});

function SidebarDeviceRowOutlet({
  snapshot,
  index,
  collapsed,
  open,
}: {
  snapshot: ControlSnapshot;
  index: number;
  collapsed: boolean;
  open: (index: number) => void;
}): ReactNode {
  const locale = snapshot.preferences.locale;
  const device = snapshot.devices.find((entry) => entry.index === index);
  if (!device) return null;
  const live = device.selected && (snapshot.deviceStatus !== null || snapshot.keyboard !== null);
  const status = live ? snapshot.deviceStatus : null;
  return (
    <SidebarDeviceRow
      locale={locale}
      device={device}
      live={live}
      batteryPercent={status?.batteryPercent ?? null}
      batteryState={status?.batteryState ?? "Unknown"}
      collapsed={collapsed}
      open={open}
    />
  );
}

export function AppSidebar({
  snapshot,
  page,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  onOpenWhatsNew,
  onOpenDevice,
}: {
  snapshot: ControlSnapshot;
  page: DesktopPage;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: (page: DesktopPage) => void;
  onOpenWhatsNew: () => void;
  onOpenDevice: (index: number) => void;
}): ReactNode {
  const locale = snapshot.preferences.locale;
  const devices = snapshot.devices;
  const goHome = useCallback(() => onNavigate("home"), [onNavigate]);
  const goHardwareTest = useCallback(() => onNavigate("hardware-test"), [onNavigate]);
  const goGames = useCallback(() => onNavigate("games"), [onNavigate]);
  const goSettings = useCallback(() => onNavigate("settings"), [onNavigate]);

  return (
    <aside className={`om-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="om-sidebar-head">
        <a className="om-brand" href={OPENMOUSE_URL} target="_blank" rel="noreferrer" title={displayText(locale, "openmouse.app")}>
          <img className="om-brand-mark" src="/logo.png" alt="" width={14} height={21} />
          <span className="om-brand-text">
            <span className="om-brand-name">OpenMouse</span>
            <span className="om-brand-build">{displayText(locale, snapshot.buildLabel)}</span>
          </span>
        </a>
        <button
          type="button"
          className="om-icon-btn om-sidebar-toggle"
          aria-label={t(locale, collapsed ? "nav.expand" : "nav.collapse")}
          title={t(locale, collapsed ? "nav.expand" : "nav.collapse")}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronRight strokeWidth={2} aria-hidden="true" /> : <ChevronLeft strokeWidth={2} aria-hidden="true" />}
        </button>
      </div>

      <nav className="om-nav" aria-label={t(locale, "nav.main")}>
        <NavItem
          icon={LayoutGrid}
          label={t(locale, "nav.devices")}
          active={page === "home" || page === "dashboard"}
          onClick={goHome}
          collapsed={collapsed}
        />
        <NavItem
          icon={Activity}
          label={t(locale, "nav.hardwareTest")}
          active={page === "hardware-test"}
          onClick={goHardwareTest}
          collapsed={collapsed}
        />
        <NavItem
          icon={Gamepad2}
          label={t(locale, "nav.games")}
          active={page === "games"}
          onClick={goGames}
          collapsed={collapsed}
        />
      </nav>

      {devices.length > 0 ? (
        <section className="om-side-devices" aria-labelledby="om-side-devices-title">
          <h2 id="om-side-devices-title" className="om-side-heading">{t(locale, "nav.yourDevices")}</h2>
          <ul>
            {devices.map((device) => (
              <SidebarDeviceRowOutlet
                key={device.index}
                snapshot={snapshot}
                index={device.index}
                collapsed={collapsed}
                open={onOpenDevice}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="om-sidebar-foot">
        <nav className="om-nav" aria-label={t(locale, "nav.more")}>
          <NavItem icon={BookOpen} label={t(locale, "nav.docs")} href="https://docs.openmouse.app" external collapsed={collapsed} />
          <NavItem icon={Megaphone} label={t(locale, "nav.whatsNew")} onClick={onOpenWhatsNew} collapsed={collapsed} />
          <a
            className="om-nav-item om-nav-discord"
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            title={collapsed ? t(locale, "nav.help") : undefined}
          >
            <DiscordIcon className="om-nav-icon om-nav-icon-discord" />
            <span className="om-nav-text">
              <span className="om-nav-label">{t(locale, "nav.help")}</span>
              <span className="om-nav-sub">{t(locale, "nav.helpSubtitle")}</span>
            </span>
            <span className="om-nav-ext" aria-hidden="true">↗</span>
          </a>
          <NavItem
            icon={SettingsIcon}
            label={t(locale, "nav.settings")}
            active={page === "settings"}
            onClick={goSettings}
            collapsed={collapsed}
          />
        </nav>
        <BridgeStatusButton locale={locale} collapsed={collapsed} />
      </div>
    </aside>
  );
}
