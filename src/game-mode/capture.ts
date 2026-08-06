import { buildFingerprint } from "./fingerprint";
import { recordHidTranscript } from "./hid-recorder";
import type { CollectionFingerprint, EnrollDeviceMessage, RecipeStep } from "./types";

export interface PollingRateClient {
  device: HIDDevice;
  setPollingRate(rate: number): Promise<unknown>;
}

/**
 * Captures idle+gaming recipes by actually calling the already-connected
 * vendor client's own setPollingRate() through a recording device wrapper,
 * then hashes the result into a stable deviceKey. Gaming is captured first
 * and idle last so the physical mouse ends the flow at its idle rate,
 * matching what the rest of the UI already shows as "the current rate".
 */
export async function captureGameModeRecipe(
  client: PollingRateClient,
  vendorId: number,
  productId: number,
  brand: string,
  name: string,
  idleRateHz: number,
  gamingRateHz: number,
): Promise<EnrollDeviceMessage> {
  const gamingSteps = await captureRate(client, gamingRateHz);
  const idleSteps = await captureRate(client, idleRateHz);

  const fingerprint = buildFingerprint(client.device);
  const deviceKey = await computeDeviceKey(vendorId, productId, fingerprint);

  return {
    type: "enrollDevice",
    deviceKey,
    vendorId,
    productId,
    brand,
    name,
    fingerprint,
    idleSteps,
    gamingSteps,
    idleRateHz,
    gamingRateHz,
  };
}

async function captureRate(client: PollingRateClient, rateHz: number): Promise<RecipeStep[]> {
  const recorder = recordHidTranscript(client.device);
  try {
    await client.setPollingRate(rateHz);
    return recorder.steps();
  } finally {
    recorder.stop();
  }
}

export async function computeDeviceKey(vendorId: number, productId: number, fingerprint: CollectionFingerprint): Promise<string> {
  const text = `${vendorId}:${productId}:${JSON.stringify(fingerprint.usages)}:${JSON.stringify(fingerprint.reports.map((r) => [r.kind, r.reportId]))}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${vendorId.toString(16)}:${productId.toString(16)}:${hex.slice(0, 16)}`;
}
