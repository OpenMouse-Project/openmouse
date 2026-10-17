import { Bluetooth, Cable, Crosshair, Gauge, Layers, Usb, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import * as control from "../../device/controller";
import { connectionText, t } from "../../i18n/index";
import type { InterfaceLocale } from "../settings/interface-preferences";
import { BatteryIcon } from "../../shared/ui";

export function ConnectionIcon({ type, transport }: { type: string | null | undefined; transport?: "bridge" | "webhid" }): ReactNode {
  const value = (type ?? "").toLowerCase();
  if (value.includes("bluetooth")) return <Bluetooth strokeWidth={1.8} aria-hidden="true" />;
  if (value.includes("wire") && !value.includes("wireless")) return <Cable strokeWidth={1.8} aria-hidden="true" />;
  if (value.includes("wireless") || value.includes("2.4") || value.includes("receiver")) return <Wifi strokeWidth={1.8} aria-hidden="true" />;
  if (transport === "bridge") return <Usb strokeWidth={1.8} aria-hidden="true" />;
  return <Usb strokeWidth={1.8} aria-hidden="true" />;
}

export function DeviceStats({
  status,
  locale,
  transport,
  full = false,
}: {
  status: MouseStatus;
  locale: InterfaceLocale;
  transport?: "bridge" | "webhid";
  full?: boolean;
}): ReactNode {
  const estimate = status.batteryPercent !== null ? control.batteryEstimateParts(status, locale) : null;
  return (
    <div className="om-stats" aria-label={t(locale, "dev.status")}>
      {status.connectionType ? (
        <span className="om-stat" title={status.connectionDetail ?? undefined}>
          <ConnectionIcon type={status.connectionType} transport={transport} />
          <span>{connectionText(locale, status.connectionType)}</span>
        </span>
      ) : null}
      {status.batteryPercent !== null ? (
        <span className="om-stat" title={estimate ? `${estimate.time} ${estimate.label}` : undefined}>
          <BatteryIcon percent={status.batteryPercent} state={status.batteryState} />
          <b>{status.batteryPercent}%</b>
          {estimate && full ? <span className="om-muted">{estimate.time}</span> : null}
        </span>
      ) : null}
      {status.pollingRateHz > 0 ? (
        <span className="om-stat">
          <Gauge strokeWidth={1.8} aria-hidden="true" />
          <b>{status.pollingRateHz.toLocaleString()}</b>
          <span className="om-muted">Hz</span>
        </span>
      ) : null}
      {full && status.dpi > 0 ? (
        <span className="om-stat">
          <Crosshair strokeWidth={1.8} aria-hidden="true" />
          <b>{status.dpi.toLocaleString()}</b>
          <span className="om-muted">{"DPI"}</span>
        </span>
      ) : null}
      {full && status.activeProfile != null ? (
        <span className="om-stat">
          <Layers strokeWidth={1.8} aria-hidden="true" />
          <span className="om-muted">{t(locale, "ov.profile")}</span>
          <b>{status.activeProfile}</b>
        </span>
      ) : null}
    </div>
  );
}
