import { supabaseAdmin } from "../supabaseAdmin.ts";
import { decodeTokenKey, decryptToken, encryptToken } from "./tokenCrypto.ts";
import {
  buildCodeExchangeBody,
  buildRefreshTokenBody,
  grantedScopes,
  publicFunctionsOrigin,
  shouldRefreshAccessToken,
} from "./googleOAuth.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export class GmailConfigError extends Error {
  constructor() {
    super("Gmail OAuth is not configured");
    this.name = "GmailConfigError";
  }
}

export class GmailAuthError extends Error {
  constructor() {
    super("Gmail rejected the mailbox connection");
    this.name = "GmailAuthError";
  }
}

export class GmailApiError extends Error {
  status: number;

  constructor(status: number) {
    super("Gmail request failed");
    this.name = "GmailApiError";
    this.status = status;
  }
}

export type GmailConnectionRow = {
  sales_id: number;
  google_email: string;
  connected_at: string;
  refresh_token_ciphertext: string;
  access_token_ciphertext: string | null;
  access_token_expires_at: string | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    console.error(`Missing ${name}`);
    throw new GmailConfigError();
  }
  return value;
}

export function gmailOAuthConfig() {
  return {
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    stateSecret: requireEnv("GMAIL_OAUTH_STATE_SECRET"),
    redirectUri: googleRedirectUri(),
  };
}

export function googleRedirectUri(): string {
  const origin = publicFunctionsOrigin(
    requireEnv("SUPABASE_URL"),
    Deno.env.get("SB_JWT_ISSUER"),
  );
  return `${origin}/functions/v1/gmail-oauth/callback`;
}

export function profileRedirect(result: "connected" | "error"): Response {
  const base = requireEnv("CRM_BASE_URL").replace(/\/$/, "");
  return Response.redirect(`${base}/#/profile?gmail=${result}`, 302);
}

function tokenKey(): Uint8Array {
  return decodeTokenKey(requireEnv("GMAIL_TOKEN_KEY"));
}

export async function exchangeAuthorizationCode(code: string) {
  const config = gmailOAuthConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildCodeExchangeBody({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    }),
  });
  if (!response.ok) {
    console.error("Google token exchange failed", response.status);
    throw new Error("Google token exchange failed");
  }
  const token = (await response.json()) as TokenResponse;
  if (!token.access_token || !token.refresh_token) {
    throw new Error("Google did not return a refresh token");
  }
  const profileResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) {
    console.error("Google userinfo failed", profileResponse.status);
    throw new Error("Google userinfo failed");
  }
  const profile = (await profileResponse.json()) as {
    email?: string;
    sub?: string;
  };
  if (!profile.email || !profile.sub) {
    throw new Error("Google account has no email");
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in ?? 3600,
    scopes: grantedScopes(token.scope),
    email: profile.email,
    sub: profile.sub,
  };
}

export async function saveGmailConnection(input: {
  salesId: number;
  email: string;
  sub: string;
  scopes: string[];
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}) {
  const key = tokenKey();
  const { error } = await supabaseAdmin.from("gmail_connections").upsert(
    {
      sales_id: input.salesId,
      google_email: input.email,
      google_sub: input.sub,
      scopes: input.scopes,
      refresh_token_ciphertext: await encryptToken(input.refreshToken, key),
      access_token_ciphertext: await encryptToken(input.accessToken, key),
      access_token_expires_at: new Date(
        Date.now() + input.expiresIn * 1000,
      ).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "sales_id" },
  );
  if (error) throw error;
}

export async function loadGmailConnection(
  salesId: number,
): Promise<GmailConnectionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("gmail_connections")
    .select(
      "sales_id, google_email, connected_at, refresh_token_ciphertext, access_token_ciphertext, access_token_expires_at",
    )
    .eq("sales_id", salesId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function accessTokenFor(row: GmailConnectionRow): Promise<string> {
  const key = tokenKey();
  if (
    row.access_token_ciphertext &&
    !shouldRefreshAccessToken(row.access_token_expires_at, Date.now())
  ) {
    return decryptToken(row.access_token_ciphertext, key);
  }

  const refreshToken = await decryptToken(row.refresh_token_ciphertext, key);
  const config = gmailOAuthConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildRefreshTokenBody({
      refreshToken,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
  });
  if (!response.ok) {
    console.error("Google token refresh failed", response.status);
    throw new GmailAuthError();
  }
  const token = (await response.json()) as TokenResponse;
  if (!token.access_token) throw new GmailAuthError();

  const { error } = await supabaseAdmin
    .from("gmail_connections")
    .update({
      refresh_token_ciphertext: token.refresh_token
        ? await encryptToken(token.refresh_token, key)
        : row.refresh_token_ciphertext,
      access_token_ciphertext: await encryptToken(token.access_token, key),
      access_token_expires_at: new Date(
        Date.now() + (token.expires_in ?? 3600) * 1000,
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("sales_id", row.sales_id);
  if (error) throw error;
  return token.access_token;
}

export async function disconnectGmail(row: GmailConnectionRow): Promise<void> {
  try {
    const refreshToken = await decryptToken(
      row.refresh_token_ciphertext,
      tokenKey(),
    );
    const response = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    if (!response.ok) {
      console.error("Google token revoke failed", response.status);
    }
  } catch (error) {
    console.error("Google token revoke failed", error);
  }

  const { error } = await supabaseAdmin
    .from("gmail_connections")
    .delete()
    .eq("sales_id", row.sales_id);
  if (error) throw error;
}

export async function gmailRequest(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  if (response.ok) return response;

  const detail = await response.text();
  console.error("Gmail API error", response.status, detail.slice(0, 300));
  if (response.status === 401 || response.status === 403) {
    throw new GmailAuthError();
  }
  throw new GmailApiError(response.status);
}
