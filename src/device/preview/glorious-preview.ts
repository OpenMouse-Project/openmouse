import { gloriousModel, type GloriousModel } from "@openmouse/keyboard-protocol/glorious";
import { GloriousKeyboardClient, type GloriousSender } from "../glorious-keyboard.ts";

/**
 * Preview stand-ins for Glorious keyboards: the real panel-side client with a
 * sender that sends nothing and a record kept in memory only.
 */
export const GLORIOUS_PREVIEW_KEYS = ["glorious-gmmk2-65-iso", "glorious-gmmk3-he-75"] as const;
export type GloriousPreviewKey = typeof GLORIOUS_PREVIEW_KEYS[number];

const PREVIEWS: Record<GloriousPreviewKey, { label: string; vendorId: number; productId: number }> = {
  "glorious-gmmk2-65-iso": { label: "GMMK 2 65% ISO (preview data)", vendorId: 0x320f, productId: 0x504a },
  "glorious-gmmk3-he-75": { label: "GMMK 3 HE 75% (preview data)", vendorId: 0x342d, productId: 0xe3de },
};

export function gloriousPreviewLabel(key: GloriousPreviewKey): string {
  return PREVIEWS[key].label;
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

export function gloriousPreviewClient(key: GloriousPreviewKey): GloriousKeyboardClient {
  const { vendorId, productId } = PREVIEWS[key];
  const model: GloriousModel | undefined = gloriousModel(vendorId, productId);
  if (!model) throw new Error(`No Glorious model for preview ${key}.`);
  const device = { vendorId, productId, productName: model.name, opened: true, collections: [] } as unknown as HIDDevice;
  const sender: GloriousSender = { device, model, open: async () => {}, close: async () => {}, send: async () => {} };
  return new GloriousKeyboardClient(device, sender, memoryStorage());
}
