import { describe, expect, it } from "vitest";
import { base64UrlToBytes, bytesToBase64, bytesToBase64Url } from "./bytes";
import {
  GMAIL_OAUTH_SCOPES,
  buildGoogleConsentUrl,
  buildRefreshTokenBody,
  publicFunctionsOrigin,
  shouldRefreshAccessToken,
} from "./googleOAuth";
import {
  attachmentBytesToBase64,
  buildDraftBody,
  buildMessageListPath,
  buildSendBody,
  MailInputError,
  parseGmailMessage,
} from "./gmailMessages";

describe("google oauth requests", () => {
  it("asks for offline access and the mailbox scopes", () => {
    const url = new URL(
      buildGoogleConsentUrl({
        clientId: "client",
        redirectUri: "https://example.test/callback",
        state: "signed-state",
      }),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.test/callback",
    );
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      ...GMAIL_OAUTH_SCOPES,
    ]);
  });

  it("rewrites the local Kong origin to the host URL", () => {
    expect(
      publicFunctionsOrigin(
        "http://kong:8000",
        "http://127.0.0.1:55321/auth/v1",
      ),
    ).toBe("http://127.0.0.1:55321");
    expect(
      publicFunctionsOrigin(
        "https://example.supabase.co/",
        "http://127.0.0.1:55321/auth/v1",
      ),
    ).toBe("https://example.supabase.co");
  });

  it("builds a refresh-token request body", () => {
    const body = new URLSearchParams(
      buildRefreshTokenBody({
        refreshToken: "refresh",
        clientId: "client",
        clientSecret: "secret",
      }),
    );
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh");
    expect(body.get("client_secret")).toBe("secret");
  });

  it("refreshes an access token inside the skew window", () => {
    const now = Date.parse("2026-10-31T18:00:00Z");
    expect(shouldRefreshAccessToken(null, now)).toBe(true);
    expect(
      shouldRefreshAccessToken(new Date(now + 30_000).toISOString(), now),
    ).toBe(true);
    expect(
      shouldRefreshAccessToken(new Date(now + 10 * 60_000).toISOString(), now),
    ).toBe(false);
  });
});

describe("gmail requests", () => {
  it("caps search page size and keeps the query", () => {
    const url = new URL(
      buildMessageListPath({ q: "from:ada@example.com", maxResults: 500 }),
    );
    expect(url.searchParams.get("q")).toBe("from:ada@example.com");
    expect(url.searchParams.get("maxResults")).toBe("50");
  });

  it("reads nested bodies and attachment metadata", () => {
    const parsed = parseGmailMessage({
      id: "msg1",
      threadId: "thr1",
      snippet: "Hello",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "ada@example.com" },
          { name: "Subject", value: "Hello" },
          { name: "Message-Id", value: "<m1@example.com>" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                body: { data: bytesToBase64Url(text("Hello")) },
              },
              {
                mimeType: "text/html",
                body: { data: bytesToBase64Url(text("<p>Hello</p>")) },
              },
            ],
          },
          {
            filename: "notes.txt",
            mimeType: "text/plain",
            body: {
              size: 4,
              attachmentId: "att1",
              data: bytesToBase64Url(text("skip")),
            },
          },
        ],
      },
    });

    expect(parsed.headers.from).toBe("ada@example.com");
    expect(parsed.headers.messageId).toBe("<m1@example.com>");
    expect(parsed.text).toBe("Hello");
    expect(parsed.html).toBe("<p>Hello</p>");
    expect(parsed.attachments).toEqual([
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        size: 4,
        attachmentId: "att1",
      },
    ]);
  });

  it("builds a sendable raw message", () => {
    const body = buildSendBody({
      to: ["ada@example.com"],
      cc: "grace@example.com",
      subject: "Café",
      text: "See you then",
      threadId: "thr1",
      inReplyTo: "<m1@example.com>",
    });
    const raw = new TextDecoder().decode(base64UrlToBytes(body.raw));
    expect(body.threadId).toBe("thr1");
    expect(raw).toContain("To: ada@example.com");
    expect(raw).toContain("Cc: grace@example.com");
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain("In-Reply-To: <m1@example.com>");
    expect(raw).toContain("See you then");
  });

  it("wraps a draft around the same raw message", () => {
    const draft = buildDraftBody({
      to: "ada@example.com",
      html: "<p>Draft</p>",
    });
    const raw = new TextDecoder().decode(base64UrlToBytes(draft.message.raw));
    expect(raw).toContain("Content-Type: text/html; charset=UTF-8");
    expect(raw).toContain("<p>Draft</p>");
  });

  it("rejects header injection", () => {
    expect(() =>
      buildSendBody({
        to: "ada@example.com",
        subject: "Hi\nBcc: x",
        text: "n",
      }),
    ).toThrow(MailInputError);
  });

  it("converts attachment bytes to standard base64", () => {
    expect(attachmentBytesToBase64(bytesToBase64Url(text("a")))).toBe(
      bytesToBase64(text("a")),
    );
  });
});

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
