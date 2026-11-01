import { describe, expect, it } from "vitest";
import {
  oauthStateExpiry,
  signOAuthState,
  verifyOAuthState,
} from "./oauthState";
import { functionSubpath, isGmailResourceId } from "./routing";

const secret = "state-secret";

describe("oauth state", () => {
  it("accepts a state it just signed", async () => {
    const now = Date.parse("2026-10-31T18:00:00Z");
    const state = await signOAuthState(
      {
        userId: "user-1",
        nonce: "nonce-1",
        exp: oauthStateExpiry(now),
      },
      secret,
    );
    expect(await verifyOAuthState(state, secret, now)).toEqual({
      userId: "user-1",
      nonce: "nonce-1",
      exp: oauthStateExpiry(now),
    });
  });

  it("rejects a tampered signature", async () => {
    const now = Date.parse("2026-10-31T18:00:00Z");
    const state = await signOAuthState(
      { userId: "user-1", nonce: "nonce-1", exp: oauthStateExpiry(now) },
      secret,
    );
    const flipped = state.endsWith("A")
      ? `${state.slice(0, -1)}B`
      : `${state.slice(0, -1)}A`;
    expect(await verifyOAuthState(flipped, secret, now)).toBeNull();
  });

  it("rejects an expired state", async () => {
    const now = Date.parse("2026-10-31T18:00:00Z");
    const state = await signOAuthState(
      { userId: "user-1", nonce: "nonce-1", exp: 1 },
      secret,
    );
    expect(await verifyOAuthState(state, secret, now)).toBeNull();
  });

  it("rejects a state signed with another secret", async () => {
    const now = Date.parse("2026-10-31T18:00:00Z");
    const state = await signOAuthState(
      { userId: "user-1", nonce: "nonce-1", exp: oauthStateExpiry(now) },
      "other-secret",
    );
    expect(await verifyOAuthState(state, secret, now)).toBeNull();
  });
});

describe("function paths", () => {
  it("keeps the path after the function name", () => {
    expect(
      functionSubpath(
        "http://127.0.0.1:54321/functions/v1/gmail-oauth/callback?code=1",
        "gmail-oauth",
      ),
    ).toBe("/callback");
    expect(
      functionSubpath(
        "http://edge/gmail/messages/abc/attachments/def",
        "gmail",
      ),
    ).toBe("/messages/abc/attachments/def");
  });

  it("accepts gmail resource ids", () => {
    expect(isGmailResourceId("18c5f3ab_12")).toBe(true);
    expect(isGmailResourceId("../secret")).toBe(false);
  });
});
