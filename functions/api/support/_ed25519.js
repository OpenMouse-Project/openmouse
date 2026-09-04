// Minimal self-contained Ed25519 *verification* only (RFC 8032), vendored so the
// Cloudflare Pages Functions can verify Discord Interaction request signatures
// WITHOUT depending on WebCrypto Ed25519 (which Workers does not provide; only
// Node does) or on any external package.
//
// This module deliberately implements ONLY the verify path — no key generation,
// no signing. It is arithmetic over the field GF(2^255-19) using the standard
// twisted Edwards curve used by Ed25519.
//
// It is tested against Node's native WebCrypto Ed25519 in _ed25519.test via a
// random-vector loop (generate key+signature natively, verify here).
//
// Public API:
//   verify(publicKey (Uint8Array,32), message (Uint8Array), signature (Uint8Array,64)) -> boolean

const P = 2n ** 255n - 19n;
const L =
  2n ** 252n +
  27742317777372353535851937790883648493n; // group order
const D = (-121665n * modinv(121666n, P)) % P;
const I = modpow(2n, (P - 1n) / 4n, P); // sqrt(-1)

function mod(a, b) {
  const r = a % b;
  return r >= 0n ? r : r + b;
}
function modpow(a, e, m) {
  let x = 1n;
  let base = mod(a, m);
  let exp = e;
  while (exp > 0n) {
    if (exp & 1n) x = (x * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return x;
}
function modinv(a, m) {
  return modpow(mod(a, m), m - 2n, m); // prime modulus -> Fermat
}
function modsqrt(a) {
  // sqrt modulo P using exponent (P+3)/8 (P ≡ 5 mod 8)
  const aP = mod(a, P);
  const x = modpow(aP, (P + 3n) / 8n, P);
  if ((x * x) % P === aP) return x;
  const y = (x * I) % P;
  if ((y * y) % P === aP) return y;
  return null;
}

// Recover y from a compressed point's x-sign bit (for y^2 = (x^2-1)/(d x^2+1))
function decompress(point) {
  const y = bytesToBigUintLE(point.subarray(0, 32)) & ((1n << 255n) - 1n);
  const xSign = point[31] >> 7;
  const y2 = (y * y) % P;
  const u = (y2 - 1n) % P;
  const v = (D * y2 + 1n) % P;
  const x = modsqrt((u * modinv(v, P)) % P);
  if (x === null) return null;
  // The compressed encoding's high bit stores the PARITY (lowest bit) of x,
  // so match the recovered root's parity to the stored sign bit.
  let px = x;
  if ((px & 1n) !== BigInt(xSign)) px = P - px;
  const compressed = compressPoint(px, y);
  return { x: px, y, encoded: compressed };
}

function compressPoint(x, y) {
  const xSign = x & 1n;
  const buf = new Uint8Array(32);
  const yMod = mod(y, P);
  for (let i = 0; i < 32; i++) buf[i] = Number((yMod >> BigInt(8 * i)) & 0xffn);
  if (xSign) buf[31] |= 0x80;
  return buf;
}

function bytesToBigUintLE(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

// Extended Edwards point (x, y, z, t)
const ZERO = { x: 0n, y: 1n, z: 1n, t: 0n };
const BASE = fromAffine(decompress(new Uint8Array([
  0x58, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
  0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
])));
function fromAffine(p) {
  return { x: p.x, y: p.y, z: 1n, t: (p.x * p.y) % P };
}
function toAffine(p) {
  const zInv = modinv(p.z, P);
  return { x: (p.x * zInv) % P, y: (p.y * zInv) % P };
}
function pointAdd(p, q) {
  const a = mod((p.y - p.x) * (q.y - q.x), P);
  const b = mod((p.y + p.x) * (q.y + q.x), P);
  const c = mod(2n * p.t * q.t * D, P);
  const d = mod(2n * p.z * q.z, P);
  const e = mod(b - a, P);
  const f = mod(d - c, P);
  const g = mod(d + c, P);
  const h = mod(b + a, P);
  return {
    x: (e * f) % P,
    y: (g * h) % P,
    t: (e * h) % P,
    z: (f * g) % P,
  };
}
function pointDouble(p) {
  // dbl-2008-hwcd for a = -1 (twisted Edwards)
  const A = mod(p.x * p.x, P);
  const B = mod(p.y * p.y, P);
  const C = mod(2n * p.z * p.z, P);
  const D = mod(-A, P); // a*A with a=-1
  const sumXY = p.x + p.y;
  const E = mod((sumXY * sumXY) - A - B, P); // (x+y)^2 - A - B = 2xy
  const G = mod(D + B, P); // B - A
  const F = mod(G - C, P);
  const H = mod(D - B, P); // -A - B
  return {
    x: mod(E * F, P),
    y: mod(G * H, P),
    z: mod(F * G, P),
    t: mod(E * H, P),
  };
}
function pointMulScalar(point, scalar) {
  let result = ZERO;
  let addend = point;
  let n = scalar;
  while (n > 0n) {
    if (n & 1n) result = result === ZERO ? addend : pointAdd(result, addend);
    addend = pointDouble(addend);
    n >>= 1n;
  }
  return result;
}

async function sha512(bytes) {
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return new Uint8Array(digest);
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verify(publicKey, message, signature) {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const A = decompress(publicKey);
  if (A === null) return false;
  const Rraw = signature.subarray(0, 32);
  const R = decompress(Rraw);
  if (R === null) return false;
  const s = bytesToBigUintLE(signature.subarray(32));
  if (s >= L) return false;

  const hRam = await sha512(
    concatBytes(Rraw, publicKey, message),
  );
  const h = bytesToBigUintLE(hRam) % L;

  // S*B ?= R + h*A  (equivalently: verify [S]B - [h]A == R)
  const sb = toAffine(pointMulScalar(BASE, s));
  const ha = toAffine(pointMulScalar(fromAffine(A), h));
  const negHa = { ...ha, x: mod(P - ha.x, P) };
  const check = toAffine(pointAdd(fromAffine(sb), fromAffine(negHa)));
  const checkEncoded = compressPoint(check.x, check.y);
  return bytesEqual(checkEncoded, Rraw);
}

function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
