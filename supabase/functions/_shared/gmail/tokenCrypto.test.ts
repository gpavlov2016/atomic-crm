import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./bytes";
import { decryptToken, decodeTokenKey, encryptToken } from "./tokenCrypto";

const key = decodeTokenKey(bytesToBase64(new Uint8Array(32).fill(7)));

describe("token ciphertext", () => {
  it("round-trips a refresh token", async () => {
    const ciphertext = await encryptToken("refresh-token", key);
    expect(ciphertext).not.toContain("refresh-token");
    expect(await decryptToken(ciphertext, key)).toBe("refresh-token");
  });

  it("uses a fresh iv for each encryption", async () => {
    const first = await encryptToken("same", key);
    const second = await encryptToken("same", key);
    expect(first).not.toBe(second);
    expect(await decryptToken(second, key)).toBe("same");
  });

  it("rejects a tampered ciphertext", async () => {
    const ciphertext = await encryptToken("refresh-token", key);
    const [iv, body] = ciphertext.split(".");
    const flipped = body!.slice(0, -1) + (body!.endsWith("A") ? "B" : "A");
    await expect(decryptToken(`${iv}.${flipped}`, key)).rejects.toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => decodeTokenKey(bytesToBase64(new Uint8Array(16)))).toThrow(
      /32 bytes/,
    );
  });
});
