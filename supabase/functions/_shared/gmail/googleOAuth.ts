export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
] as const;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// Local edge functions see SUPABASE_URL as http://kong:8000. Google and the
// browser need the host origin, which SB_JWT_ISSUER already records.
export function publicFunctionsOrigin(
  supabaseUrl: string,
  jwtIssuer: string | undefined,
): string {
  const base = supabaseUrl.replace(/\/$/, "");
  if (!base.startsWith("http://kong:8000")) return base;
  const localUrl = (jwtIssuer ?? "").replace(/\/auth\/v1\/?$/, "");
  if (!localUrl) return base;
  return base.replace("http://kong:8000", localUrl);
}

export function buildGoogleConsentUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "select_account consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function buildCodeExchangeBody(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): string {
  return new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  }).toString();
}

export function buildRefreshTokenBody(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): string {
  return new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
  }).toString();
}

export function grantedScopes(scope: unknown): string[] {
  if (typeof scope !== "string" || scope.trim() === "") {
    return [...GMAIL_OAUTH_SCOPES];
  }
  return scope.split(" ").filter(Boolean);
}

export const ACCESS_TOKEN_SKEW_MS = 60_000;

export function shouldRefreshAccessToken(
  expiresAt: string | null,
  nowMs: number,
): boolean {
  if (!expiresAt) return true;
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) return true;
  return expires - nowMs <= ACCESS_TOKEN_SKEW_MS;
}
