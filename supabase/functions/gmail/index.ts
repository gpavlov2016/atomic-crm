import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { User } from "jsr:@supabase/supabase-js@2";
import { UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import {
  accessTokenFor,
  GmailAccountAmbiguous,
  GmailApiError,
  GmailAuthError,
  GmailConfigError,
  GmailNotConnected,
  gmailRequest,
  listGmailConnections,
  pickGmailConnection,
} from "../_shared/gmail/gmailAccess.ts";
import {
  attachmentBytesToBase64,
  attachmentUrl,
  buildDraftBody,
  buildMessageListPath,
  buildSendBody,
  MailInputError,
  messageUrl,
  metadataUrl,
  parseGmailMessage,
  type OutgoingMail,
} from "../_shared/gmail/gmailMessages.ts";
import {
  errorResponse,
  jsonResponse,
  optionsResponse,
} from "../_shared/gmail/http.ts";
import {
  functionSubpath,
  isGmailResourceId,
} from "../_shared/gmail/routing.ts";

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

type GmailRoute =
  | { kind: "status" }
  | { kind: "search" }
  | { kind: "send" }
  | { kind: "draft" }
  | { kind: "message"; messageId: string }
  | { kind: "attachment"; messageId: string; attachmentId: string }
  | { kind: "unknown" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();

  try {
    const route = matchRoute(req.method, functionSubpath(req.url, "gmail"));
    if (route.kind === "unknown") return errorResponse(404, "Not found");
    return await UserMiddleware(req, (_request, user) => {
      if (!user) return errorResponse(401, "Unauthorized");
      return handle(req, user, route);
    });
  } catch (error) {
    return failure(error);
  }
});

async function handle(
  req: Request,
  user: User,
  route: Exclude<GmailRoute, { kind: "unknown" }>,
): Promise<Response> {
  const sale = await getUserSale(user);
  if (!sale) return errorResponse(403, "No salesperson profile for this user");

  switch (route.kind) {
    case "status":
      return connectionStatus(sale.id);
    case "search": {
      const body = await readJson(req);
      return searchMessages(await mailboxToken(sale.id, body), body);
    }
    case "send": {
      const body = await readJson(req);
      return sendMessage(
        await mailboxToken(sale.id, body),
        parseOutgoing(body),
      );
    }
    case "draft": {
      const body = await readJson(req);
      return createDraft(
        await mailboxToken(sale.id, body),
        parseOutgoing(body),
      );
    }
    case "message":
      return readMessage(
        await mailboxToken(sale.id, googleEmailQuery(req)),
        route.messageId,
      );
    case "attachment":
      return readAttachment(
        await mailboxToken(sale.id, googleEmailQuery(req)),
        route.messageId,
        route.attachmentId,
      );
    default: {
      const unreachable: never = route;
      throw new Error(`Unhandled Gmail route: ${JSON.stringify(unreachable)}`);
    }
  }
}

async function connectionStatus(salesId: number): Promise<Response> {
  const rows = await listGmailConnections(salesId);
  const connections = rows.map((row) => ({
    googleEmail: row.google_email,
    connectedAt: row.connected_at,
  }));
  if (rows.length !== 1) {
    return jsonResponse(200, {
      connected: rows.length > 0,
      connections,
    });
  }
  return jsonResponse(200, {
    connected: true,
    googleEmail: rows[0].google_email,
    connectedAt: rows[0].connected_at,
    connections,
  });
}

async function mailboxToken(salesId: number, source: unknown): Promise<string> {
  const rows = await listGmailConnections(salesId);
  const row = pickGmailConnection(rows, googleEmailValue(source));
  return accessTokenFor(row);
}

function googleEmailQuery(req: Request): string | undefined {
  return new URL(req.url).searchParams.get("googleEmail") ?? undefined;
}

function googleEmailValue(source: unknown): string | undefined {
  if (typeof source === "string" || source === undefined) return source;
  const record = recordBody(source);
  const email = record.googleEmail;
  if (email === undefined || email === null) return undefined;
  if (typeof email !== "string") {
    throw new MailInputError("googleEmail must be a string");
  }
  return email;
}

function matchRoute(method: string, path: string): GmailRoute {
  if (method === "GET" && path === "/status") return { kind: "status" };
  if (method === "POST" && path === "/search") return { kind: "search" };
  if (method === "POST" && path === "/send") return { kind: "send" };
  if (method === "POST" && path === "/drafts") return { kind: "draft" };

  const attachment = path.match(/^\/messages\/([^/]+)\/attachments\/([^/]+)$/);
  if (method === "GET" && attachment) {
    return {
      kind: "attachment",
      messageId: decodeURIComponent(attachment[1]),
      attachmentId: decodeURIComponent(attachment[2]),
    };
  }

  const message = path.match(/^\/messages\/([^/]+)$/);
  if (method === "GET" && message) {
    return {
      kind: "message",
      messageId: decodeURIComponent(message[1]),
    };
  }

  return { kind: "unknown" };
}

async function searchMessages(token: string, body: unknown): Promise<Response> {
  const record = recordBody(body);
  const q = typeof record.q === "string" ? record.q : undefined;
  const pageToken =
    typeof record.pageToken === "string" ? record.pageToken : undefined;
  const maxResults =
    typeof record.maxResults === "number" ? record.maxResults : undefined;
  const listResponse = await gmailRequest(
    token,
    buildMessageListPath({ q, maxResults, pageToken }),
  );
  const list = (await listResponse.json()) as {
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
  };
  const messages = await Promise.all(
    (list.messages ?? []).map(async (item) => {
      const metadata = await gmailRequest(token, metadataUrl(item.id));
      const parsed = parseGmailMessage(await metadata.json());
      return {
        id: parsed.id || item.id,
        threadId: parsed.threadId || item.threadId,
        snippet: parsed.snippet,
      };
    }),
  );
  return jsonResponse(200, {
    messages,
    nextPageToken: list.nextPageToken ?? null,
  });
}

async function readMessage(
  token: string,
  messageId: string,
): Promise<Response> {
  if (!isGmailResourceId(messageId)) {
    return errorResponse(400, "Invalid message id");
  }
  const response = await gmailRequest(token, messageUrl(messageId));
  return jsonResponse(200, parseGmailMessage(await response.json()));
}

async function readAttachment(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<Response> {
  if (!isGmailResourceId(messageId) || !isGmailResourceId(attachmentId)) {
    return errorResponse(400, "Invalid attachment id");
  }
  const response = await gmailRequest(
    token,
    attachmentUrl(messageId, attachmentId),
  );
  const body = (await response.json()) as { data?: string; size?: number };
  if (!body.data) return errorResponse(404, "Attachment not found");
  return jsonResponse(200, {
    data: attachmentBytesToBase64(body.data),
    size: body.size ?? null,
  });
}

async function sendMessage(
  token: string,
  mail: OutgoingMail,
): Promise<Response> {
  const response = await gmailRequest(token, SEND_URL, {
    method: "POST",
    body: JSON.stringify(buildSendBody(mail)),
  });
  const sent = (await response.json()) as { id?: string; threadId?: string };
  return jsonResponse(200, {
    id: sent.id ?? null,
    threadId: sent.threadId ?? null,
  });
}

async function createDraft(
  token: string,
  mail: OutgoingMail,
): Promise<Response> {
  const response = await gmailRequest(token, DRAFTS_URL, {
    method: "POST",
    body: JSON.stringify(buildDraftBody(mail)),
  });
  const draft = (await response.json()) as {
    id?: string;
    message?: { id?: string; threadId?: string };
  };
  return jsonResponse(200, {
    id: draft.id ?? null,
    messageId: draft.message?.id ?? null,
    threadId: draft.message?.threadId ?? null,
  });
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new MailInputError("Request body must be JSON");
  }
}

function recordBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MailInputError("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function parseOutgoing(value: unknown): OutgoingMail {
  const record = recordBody(value);
  const text = optionalString(record.text, "text");
  const html = optionalString(record.html, "html");
  return {
    to: addressField(record.to, "to"),
    cc: optionalAddressField(record.cc, "cc"),
    bcc: optionalAddressField(record.bcc, "bcc"),
    subject: optionalString(record.subject, "subject"),
    text,
    html,
    threadId: optionalString(record.threadId, "threadId"),
    inReplyTo: optionalString(record.inReplyTo, "inReplyTo"),
  };
}

function addressField(value: unknown, field: string): string | string[] {
  const addresses = optionalAddressField(value, field);
  if (addresses === undefined) {
    throw new MailInputError(`${field} is required`);
  }
  return addresses;
}

function optionalAddressField(
  value: unknown,
  field: string,
): string | string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new MailInputError(`${field} must be a string or an array of strings`);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new MailInputError(`${field} must be a string`);
  }
  return value;
}

function failure(error: unknown): Response {
  if (error instanceof GmailAccountAmbiguous) {
    return jsonResponse(409, {
      status: 409,
      message: error.message,
      googleEmails: error.emails,
    });
  }
  if (error instanceof GmailNotConnected) {
    return errorResponse(409, error.message);
  }
  if (error instanceof MailInputError) return errorResponse(400, error.message);
  if (error instanceof GmailConfigError)
    return errorResponse(500, error.message);
  if (error instanceof GmailAuthError) {
    return errorResponse(
      401,
      "Gmail rejected the mailbox connection. Connect Gmail again.",
    );
  }
  if (error instanceof GmailApiError) {
    if (error.status === 404) return errorResponse(404, "Message not found");
    return errorResponse(502, "Gmail request failed");
  }
  console.error(error);
  return errorResponse(500, "Gmail request failed");
}
