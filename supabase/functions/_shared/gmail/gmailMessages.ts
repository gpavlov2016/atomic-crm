import { bytesToBase64, bytesToBase64Url, base64UrlToBase64 } from "./bytes.ts";

export class MailInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailInputError";
  }
}

export type OutgoingMail = {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  threadId?: string;
  inReplyTo?: string;
};

export type GmailAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
};

export type ParsedGmailMessage = {
  id: string;
  threadId: string;
  snippet: string;
  headers: {
    from: string | null;
    to: string | null;
    cc: string | null;
    bcc: string | null;
    subject: string | null;
    date: string | null;
    messageId: string | null;
  };
  text: string | null;
  html: string | null;
  attachments: GmailAttachment[];
};

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailApiMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: GmailPart;
};

const DEFAULT_MAX_RESULTS = 20;
const MAX_MAX_RESULTS = 50;
const HEADER_BREAK = /[\r\n]/;

export function clampMaxResults(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(MAX_MAX_RESULTS, Math.max(1, Math.floor(value)));
}

export function buildMessageListPath(input: {
  q?: string;
  maxResults?: number;
  pageToken?: string;
}): string {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  params.set("maxResults", String(clampMaxResults(input.maxResults)));
  if (input.pageToken) params.set("pageToken", input.pageToken);
  return `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`;
}

export function messageUrl(messageId: string): string {
  return `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;
}

export function metadataUrl(messageId: string): string {
  return `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata`;
}

export function attachmentUrl(messageId: string, attachmentId: string): string {
  return `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export function buildSendBody(input: OutgoingMail): {
  raw: string;
  threadId?: string;
} {
  return buildOutgoingRaw(input);
}

export function buildDraftBody(input: OutgoingMail): {
  message: { raw: string; threadId?: string };
} {
  return { message: buildOutgoingRaw(input) };
}

export function parseGmailMessage(
  message: GmailApiMessage,
): ParsedGmailMessage {
  const collected: {
    text: string | null;
    html: string | null;
    attachments: GmailAttachment[];
  } = { text: null, html: null, attachments: [] };
  if (message.payload) collectParts(message.payload, collected);
  const headers = headerMap(message.payload?.headers ?? []);
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    snippet: message.snippet ?? "",
    headers: {
      from: headers.get("from") ?? null,
      to: headers.get("to") ?? null,
      cc: headers.get("cc") ?? null,
      bcc: headers.get("bcc") ?? null,
      subject: headers.get("subject") ?? null,
      date: headers.get("date") ?? null,
      messageId: headers.get("message-id") ?? null,
    },
    text: collected.text,
    html: collected.html,
    attachments: collected.attachments,
  };
}

export function attachmentBytesToBase64(data: string): string {
  return base64UrlToBase64(data);
}

function buildOutgoingRaw(input: OutgoingMail): {
  raw: string;
  threadId?: string;
} {
  const rfc822 = buildRfc822(input);
  return {
    raw: bytesToBase64Url(new TextEncoder().encode(rfc822)),
    ...(input.threadId ? { threadId: input.threadId } : {}),
  };
}

function buildRfc822(input: OutgoingMail): string {
  const to = addressList(input.to, "to");
  if (to.length === 0) throw new MailInputError("to is required");
  const cc = addressList(input.cc, "cc");
  const bcc = addressList(input.bcc, "bcc");
  const text = input.text ?? "";
  const html = input.html ?? "";
  if (text.trim() === "" && html.trim() === "") {
    throw new MailInputError("text or html is required");
  }
  if (input.threadId) assertHeader(input.threadId, "threadId");
  if (input.inReplyTo) assertHeader(input.inReplyTo, "inReplyTo");

  const headers = [
    `To: ${to.join(", ")}`,
    cc.length > 0 ? `Cc: ${cc.join(", ")}` : null,
    bcc.length > 0 ? `Bcc: ${bcc.join(", ")}` : null,
    `Subject: ${encodeSubject(input.subject ?? "")}`,
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : null,
    input.inReplyTo ? `References: ${input.inReplyTo}` : null,
    "MIME-Version: 1.0",
  ].filter((line): line is string => line !== null);

  let body: string;
  if (text.trim() !== "" && html.trim() !== "") {
    const boundary = `crm_${crypto.randomUUID().replace(/-/g, "")}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else if (html.trim() !== "") {
    headers.push("Content-Type: text/html; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: 8bit");
    body = html;
  } else {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: 8bit");
    body = text;
  }

  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

function addressList(
  value: string | string[] | undefined,
  field: string,
): string[] {
  if (value === undefined) return [];
  const parts = (Array.isArray(value) ? value : value.split(","))
    .map((part) => part.trim())
    .filter((part) => part !== "");
  for (const part of parts) {
    assertHeader(part, field);
    if (!/^[^\s@]+@[^\s@]+$/.test(part)) {
      throw new MailInputError(`${field} has an invalid address`);
    }
  }
  return parts;
}

function assertHeader(value: string, field: string) {
  if (HEADER_BREAK.test(value)) {
    throw new MailInputError(`${field} contains a line break`);
  }
}

function encodeSubject(subject: string): string {
  assertHeader(subject, "subject");
  if (/^[\t\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(subject))}?=`;
}

function headerMap(headers: GmailHeader[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of headers) {
    if (!header.name || header.value === undefined) continue;
    const name = header.name.toLowerCase();
    if (!map.has(name)) map.set(name, header.value);
  }
  return map;
}

function collectParts(
  part: GmailPart,
  collected: {
    text: string | null;
    html: string | null;
    attachments: GmailAttachment[];
  },
) {
  if (part.filename && part.body?.attachmentId) {
    collected.attachments.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body.size ?? 0,
      attachmentId: part.body.attachmentId,
    });
    return;
  }
  if (part.mimeType === "text/plain" && part.body?.data && !collected.text) {
    collected.text = decodeBase64UrlText(part.body.data);
  } else if (
    part.mimeType === "text/html" &&
    part.body?.data &&
    !collected.html
  ) {
    collected.html = decodeBase64UrlText(part.body.data);
  }
  for (const child of part.parts ?? []) collectParts(child, collected);
}

function decodeBase64UrlText(value: string): string {
  const bytes = Uint8Array.from(atob(base64UrlToBase64(value)), (char) =>
    char.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}
