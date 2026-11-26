import { displayText } from "../../../i18n/index";
import { useEffect, useState, type ReactNode } from "react";
import {
  dismissDfuVersion,
  dismissKeyFor,
  getDfuInfo,
  isDfuDismissed,
  loadFirmwareManifest,
  type DfuInfo,
  type FirmwareManifest,
} from "../../../device/firmware-updates";
import type { ControlSnapshot } from "../../../device/types";
import * as control from "../../../device/controller";
import { t, tp } from "../../../i18n/index";

function formatDate(locale: string, iso: string | null): string {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  try {
    return new Date(time).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export function FirmwareCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;

  const [manifest, setManifest] = useState<FirmwareManifest | null>(null);
  const [manifestDate, setManifestDate] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissTick, setDismissTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadFirmwareManifest()
      .then(({ manifest: next }) => {
        if (cancelled) return;
        setManifest(next);
        setManifestDate(next.updatedAt ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function checkNow(): Promise<void> {
    setChecking(true);
    setError(null);
    try {
      const { manifest: next } = await loadFirmwareManifest({ force: true });
      setManifest(next);
      setManifestDate(next.updatedAt ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  if (!status) return null;

  // HID identity ("046d_xxxx") lets generated manifest entries match by
  // interfaceId instead of name guessing; null falls back to name matching.
  const hid = control.getActiveDevice();
  const ref = {
    brand: status.brand,
    name: status.name,
    modelId: status.modelId ?? null,
    firmware: status.firmware ?? [],
    interfaceId: hid ? (hid.vendorId.toString(16).padStart(4, '0') + '_' + hid.productId.toString(16).padStart(4, '0')) : null,
  };
  const deviceKey = dismissKeyFor(ref);

  // Re-read dismissals after a Later click (same render pass otherwise).
  void dismissTick;
  const mouseDfu: DfuInfo | null = manifest ? getDfuInfo(ref, manifest) : null;
  const mouseVisible = mouseDfu !== null && !isDfuDismissed(deviceKey, mouseDfu.latestVersion) ? mouseDfu : null;

  const receiver = snapshot.receiverFirmware;
  // Both MCU readouts are bootloader identifiers (proven static across a
  // real 14.3.19 -> 14.4.20 flash), so they identify hardware only. They
  // can never be compared against the manifest's package versions — doing
  // so reports "update available" on receivers that are already current
  // (issue #1111). No dfuInfo is produced for the receiver; the row below
  // is informational until an app-firmware source exists.
  const receiverMcus = receiver?.mcus ?? [];

  const available = [mouseVisible].filter((info) => info?.dfuAvailable);
  const download = available.find((info) => info?.downloadUrl) ?? null;

  let pill: string;
  if (checking && !manifest) {
    pill = t(locale, "fw.checking");
  } else if (available.length > 0) {
    pill = t(locale, "fw.available");
  } else if (mouseVisible) {
    pill = t(locale, "fw.upToDate");
  } else {
    pill = t(locale, "fw.unknown");
  }
  const pillBadge = available.length > 0 ? "fw-badge-available" : undefined;

  function dismissAll(): void {
    if (mouseVisible) dismissDfuVersion(deviceKey, mouseVisible.latestVersion);
    setDismissTick((n) => n + 1);
  }

  function rowBadge(info: DfuInfo | null): ReactNode {
    if (info?.dfuAvailable !== true) return null;
    return <output className="fw-badge-available">{t(locale, "fw.available")}</output>;
  }

  function deviceDetails(info: DfuInfo | null, current: string | null): ReactNode {
    if (info === null) return null;
    const notes = info.releaseNotes && info.dfuAvailable ? info.releaseNotes : null;
    const past = info.history ?? [];
    if (!info.dfuAvailable && notes === null && past.length === 0) return null;
    return (
      <details className="fw-details" open={info.dfuAvailable || undefined}>
        <summary className="fw-transition">
          {displayText(locale, info.dfuAvailable
            ? tp(locale, "fw.versions", { current: current ?? "?", latest: info.latestVersion })
            : t(locale, "fw.history"))}
        </summary>
        {notes ? (<><span className="setting-eyebrow">{t(locale, "fw.changelog")}</span><p>{displayText(locale, notes)}</p></>) : null}
        {past.length > 0 ? (
          <ul className="fw-history">
            {past.map((entry, index) => (
              <li key={`${entry.version}-${index}`}>
                v{displayText(locale, entry.version)}{displayText(locale, entry.date ? ` · ${formatDate(locale, entry.date)}` : null)}
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    );
  }

  // The whole section is one collapsed dropdown: header row (title,
  // state pill, Check) always visible, device rows behind the toggle. The
  // Check button stops its click reaching the summary, otherwise every
  // check would also collapse the card.
  function stopToggle(event: { preventDefault: () => void; stopPropagation: () => void }): void {
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <article id="firmware-update" className="setting-card">
      <details className="fw-collapse">
      <summary>
      <div className="fw-summary-row">
        <h2 className="fw-title">{t(locale, "fw.sectionLabel")}</h2>
        <span className="fw-head-actions">
          <output id="firmware-update-output" className={pillBadge}>{displayText(locale, pill)}</output>
          <button
            type="button"
            className="om-btn is-sm"
            disabled={checking}
            onClick={(event) => { stopToggle(event); void checkNow(); }}
          >
            {displayText(locale, checking ? t(locale, "fw.checking") : error ? t(locale, "fw.retry") : t(locale, "fw.check"))}
          </button>
        </span>
      </div>
      <span className="fw-current"><span>{status.name}</span><strong>{displayText(locale, status.firmware.join(" · "))}</strong></span>
      </summary>
      {error ? (
        <small className="setting-note">{t(locale, "fw.failed")}</small>
      ) : !manifest ? (
        <small className="setting-note">
          {displayText(locale, checking ? t(locale, "fw.checking") : t(locale, "fw.unknownDetail"))}
        </small>
      ) : (
        <>
          <div className="fw-device">
            <div className="setting-heading compact">
              <div><span>{status.name}</span></div>
              {rowBadge(mouseVisible)}
            </div>
            {deviceDetails(mouseVisible, mouseDfu?.currentVersion ?? null)}
          </div>
          {receiverMcus.length > 0 ? (
            <div className="fw-device">
              <div className="setting-heading compact">
                <div><p>{t(locale, "hw.receiver")}</p></div>
              </div>
              <small className="setting-note">{t(locale, "fw.receiverIdentity")}</small>
              <ul className="fw-history">
                {receiverMcus.map((mcu) => (
                  <li key={mcu.mcu}>{tp(locale, "fw.receiverMcu", { mcu: mcu.mcu, value: mcu.version ?? "–" })}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {manifestDate ? (
            <div className="fw-meta">{tp(locale, "fw.dataFrom", { date: formatDate(locale, manifestDate) })}</div>
          ) : null}
        </>
      )}
      {(download?.downloadUrl || available.length > 0) ? (
        <div className="setting-action">
          <span>
            {download?.downloadUrl ? (
              <button
                type="button"
                className="om-btn is-primary"
                onClick={() => window.open(download.downloadUrl, "_blank", "noopener,noreferrer")}
                title={t(locale, "fw.comingSoon")}
              >
                {t(locale, "fw.download")}
              </button>
            ) : null}{' '}
            {available.length > 0 ? (
              <button type="button" className="om-btn is-ghost" onClick={dismissAll}>
                {t(locale, "fw.later")}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      </details>
    </article>
  );
}
