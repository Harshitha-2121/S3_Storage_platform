// Credential-secret cryptography.
//
// S3 access-key secrets must be verifiable for AWS SigV4, which
// requires recomputing an HMAC from the plaintext secret — a
// one-way hash is therefore not sufficient on its own. We store
// the secret AES-GCM encrypted; the encryption key lives in a
// server-side env var and is never shipped to the browser.
//
// Key resolution (in order):
//   1. S3_CREDENTIAL_ENCRYPTION_KEY — 32 bytes, base64 or hex.
//   2. Fallback (dev only): SHA-256 of a domain-separated string
//      built from the RustFS root secret. Deterministic, so
//      existing rows stay decryptable across restarts, but it
//      ties the key to the storage backend's root credential.

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function encryptionKey(): Promise<CryptoKey> {
  const configured = process.env.S3_CREDENTIAL_ENCRYPTION_KEY;
  let raw: Uint8Array;
  if (configured && configured.length > 0) {
    // Accept hex (64 chars) or base64 (~43-44 chars).
    if (/^[0-9a-fA-F]{64}$/.test(configured)) {
      raw = fromHex(configured);
    } else {
      raw = fromB64(configured);
    }
    if (raw.length !== 32) {
      throw new Error(
        "S3_CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes",
      );
    }
  } else {
    // Dev fallback: deterministic derivation from the RustFS root
    // secret. Documented as dev-only; production must set the
    // dedicated key above.
    const seed = `s3-credential-encryption:v1:${process.env.RUSTFS_SECRET_KEY ?? ""}`;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(seed),
    );
    raw = new Uint8Array(digest);
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** AES-GCM encrypt. Returns "ivB64.cipherB64". */
export async function encryptSecret(
  plaintext: string,
): Promise<string> {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${toB64(iv)}.${toB64(new Uint8Array(buf))}`;
}

/** AES-GCM decrypt (inverse of encryptSecret). */
export async function decryptSecret(cipher: string): Promise<string> {
  const key = await encryptionKey();
  const [ivB64, dataB64] = cipher.split(".");
  if (!ivB64 || !dataB64) throw new Error("Invalid encrypted secret");
  const iv = fromB64(ivB64);
  const data = fromB64(dataB64);
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return new TextDecoder().decode(buf);
}

/** SHA-256 hex verifier (for safe duplicate detection / display). */
export async function hashSecret(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(plaintext),
  );
  return toHex(new Uint8Array(digest));
}

/** Generate a random S3 access key id (e.g. s3a1b2c3...). */
export function generateAccessKeyId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `s3${toHex(bytes)}`;
}

/** Generate a random S3 secret access key. */
export function generateSecretKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes);
}

/** Constant-time comparison to avoid timing side-channels. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
