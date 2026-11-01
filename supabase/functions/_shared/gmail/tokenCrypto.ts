import { base64ToBytes, bytesToBase64Url, base64UrlToBytes } from "./bytes.ts";

const AES_KEY_BYTES = 32;

export function decodeTokenKey(keyBase64: string): Uint8Array {
  const bytes = base64ToBytes(keyBase64);
  if (bytes.length !== AES_KEY_BYTES) {
    throw new Error("GMAIL_TOKEN_KEY must be base64 for 32 bytes");
  }
  return bytes;
}

async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  const raw = new Uint8Array(keyBytes);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptToken(
  plaintext: string,
  keyBytes: Uint8Array,
): Promise<string> {
  const key = await importKey(keyBytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptToken(
  ciphertext: string,
  keyBytes: Uint8Array,
): Promise<string> {
  const [ivPart, bodyPart] = ciphertext.split(".");
  if (!ivPart || !bodyPart) {
    throw new Error("Malformed token ciphertext");
  }
  const key = await importKey(keyBytes);
  const iv = base64UrlToBytes(ivPart);
  const body = base64UrlToBytes(bodyPart);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    new Uint8Array(body),
  );
  return new TextDecoder().decode(plaintext);
}
