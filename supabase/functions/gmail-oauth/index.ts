import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { User } from "jsr:@supabase/supabase-js@2";
import { UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  disconnectGmail,
  exchangeAuthorizationCode,
  GmailConfigError,
  gmailOAuthConfig,
  loadGmailConnection,
  profileRedirect,
  saveGmailConnection,
} from "../_shared/gmail/gmailAccess.ts";
import { buildGoogleConsentUrl } from "../_shared/gmail/googleOAuth.ts";
import {
  errorResponse,
  jsonResponse,
  optionsResponse,
} from "../_shared/gmail/http.ts";
import {
  oauthStateExpiry,
  signOAuthState,
  verifyOAuthState,
} from "../_shared/gmail/oauthState.ts";
import { functionSubpath } from "../_shared/gmail/routing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();

  try {
    const path = functionSubpath(req.url, "gmail-oauth");
    if (req.method === "GET" && path === "/callback") {
      return await handleCallback(req);
    }
    if (req.method === "POST" && path === "/start") {
      return await UserMiddleware(req, (_request, user) => {
        if (!user) return errorResponse(401, "Unauthorized");
        return handleStart(user);
      });
    }
    if (req.method === "POST" && path === "/disconnect") {
      return await UserMiddleware(req, (_request, user) => {
        if (!user) return errorResponse(401, "Unauthorized");
        return handleDisconnect(user);
      });
    }
    return errorResponse(404, "Not found");
  } catch (error) {
    return failure(error);
  }
});

async function handleStart(user: User): Promise<Response> {
  const sale = await getUserSale(user);
  if (!sale) return errorResponse(403, "No salesperson profile for this user");
  const config = gmailOAuthConfig();
  const state = await signOAuthState(
    {
      userId: user.id,
      nonce: crypto.randomUUID(),
      exp: oauthStateExpiry(Date.now()),
    },
    config.stateSecret,
  );
  return jsonResponse(200, {
    url: buildGoogleConsentUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    }),
  });
}

async function handleCallback(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("error")) return profileRedirect("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return profileRedirect("error");

    const config = gmailOAuthConfig();
    const payload = await verifyOAuthState(
      state,
      config.stateSecret,
      Date.now(),
    );
    if (!payload) return profileRedirect("error");

    const { data: sale, error } = await supabaseAdmin
      .from("sales")
      .select("id")
      .eq("user_id", payload.userId)
      .maybeSingle();
    if (error || !sale) return profileRedirect("error");

    const connected = await exchangeAuthorizationCode(code);
    await saveGmailConnection({
      salesId: sale.id,
      email: connected.email,
      sub: connected.sub,
      scopes: connected.scopes,
      refreshToken: connected.refreshToken,
      accessToken: connected.accessToken,
      expiresIn: connected.expiresIn,
    });
    return profileRedirect("connected");
  } catch (error) {
    console.error(error);
    try {
      return profileRedirect("error");
    } catch (redirectError) {
      return failure(redirectError);
    }
  }
}

async function handleDisconnect(user: User): Promise<Response> {
  const sale = await getUserSale(user);
  if (!sale) return errorResponse(403, "No salesperson profile for this user");
  const row = await loadGmailConnection(sale.id);
  if (row) await disconnectGmail(row);
  return jsonResponse(200, { disconnected: true });
}

function failure(error: unknown): Response {
  if (error instanceof GmailConfigError) {
    return errorResponse(500, error.message);
  }
  console.error(error);
  return errorResponse(500, "Gmail request failed");
}
