export const gmailCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...gmailCorsHeaders,
    },
  });
}

export function errorResponse(status: number, message: string): Response {
  return jsonResponse(status, { status, message });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: gmailCorsHeaders });
}
