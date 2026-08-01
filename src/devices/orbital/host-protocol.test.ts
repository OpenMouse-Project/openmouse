import assert from "node:assert/strict";
import test from "node:test";

await import("./host-protocol.js");

const host = (globalThis as typeof globalThis & {
  OrbitalHostProtocol: { OrbitalMouseClient: new (device: HIDDevice) => { finishPacket(packet: Uint8Array, routeToMouse?: boolean): Uint8Array } };
}).OrbitalHostProtocol;

function device(productId: number): HIDDevice {
  return {
    vendorId: 0x1915,
    productId,
    productName: "Orbital test device",
    collections: [{ usagePage: 0xff0a, usage: 1 }],
  } as unknown as HIDDevice;
}

test("Orbital config packets have the required checksum", () => {
  const client = new host.OrbitalMouseClient(device(0x080c));
  const packet = new Uint8Array(64);
  packet[0] = 4;
  packet[2] = 0x81;
  packet[3] = 1;
  const finished = client.finishPacket(packet);
  const sum = finished.slice(0, 63).reduce((total, byte) => total + byte, 0);

  assert.equal(finished[63], (0xa1 - (sum & 0xff)) & 0xff);
});

test("Orbital receiver packets are routed before checksumming", () => {
  const client = new host.OrbitalMouseClient(device(0x080b));
  const finished = client.finishPacket(new Uint8Array(64));

  assert.equal(finished[0], 0x40);
  assert.equal(finished[63], 0x61);
});
