import { base64UrlToBytes, bytesToBase64Url } from "./bytes.ts";

export type OAuthStatePayload = {
  userId: string;
  nonce: string;
  exp: number;
};

const STATE_TTL_SECONDS = 10 * 60;

export function oauthStateExpiry(nowMs: number): number {
  return Math.floor(nowMs / 1000) + STATE_TTL_SECONDS;
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function signOAuthState(
  payload: OAuthStatePayload,
  secret: string,
): Promise<string> {
  const body = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await hmac(secret, body);
  return `${body}.${signature}`;
}

export async function verifyOAuthState(
  state: string,
  secret: string,
  nowMs: number,
): Promise<OAuthStatePayload | null> {
  const separator = state.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = state.slice(0, separator);
  const signature = state.slice(separator + 1);
  const expected = await hmac(secret, body);
  if (!timingSafeEqual(signature, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
  } catch {
    return null;
  }
  if (!isOAuthStatePayload(payload)) return null;
  if (payload.exp * 1000 <= nowMs) return null;
  return payload;
}

function isOAuthStatePayload(value: unknown): value is OAuthStatePayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "string" &&
    typeof record.nonce === "string" &&
    typeof record.exp === "number"
  );
}
