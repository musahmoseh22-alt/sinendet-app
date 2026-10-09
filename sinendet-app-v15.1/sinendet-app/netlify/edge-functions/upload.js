import { getStore } from "@netlify/blobs";

const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// This single-request path is now only used by the frontend for small files
// (photos, short audio clips) that comfortably fit in one request. Anything
// bigger is sent in small pieces via upload-chunk.js + upload-finalize.js
// instead, because Netlify Edge Functions have a 40-second response-header
// timeout per request — a large video sent in one request can simply take
// longer than that to transfer on a slow connection, which is the real
// reason big uploads were failing. 350MB mirrors the ceiling in
// upload-finalize.js, kept here only as a safety net for this path.
const MAX_BYTES = 350 * 1024 * 1024;

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: JSON_HEADERS });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "file";
  const id = url.searchParams.get("id");
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: JSON_HEADERS });
  }

  try {
    // Reject oversized uploads using the Content-Length header, before
    // spending time/memory buffering the whole body — the frontend already
    // checks this too, but a direct API call or a stale cached page
    // shouldn't be able to bypass it.
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BYTES) {
      return new Response(
        JSON.stringify({ error: `File is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit` }),
        { status: 413, headers: JSON_HEADERS }
      );
    }

    const contentType = request.headers.get("content-type") || "application/octet-stream";
    const buf = await request.arrayBuffer();

    if (buf.byteLength > MAX_BYTES) {
      return new Response(
        JSON.stringify({ error: `File is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit` }),
        { status: 413, headers: JSON_HEADERS }
      );
    }

    const store = getStore("media");
    const key = `${id}/${kind}-${crypto.randomUUID()}`;
    await store.set(key, buf, { metadata: { contentType } });

    return new Response(JSON.stringify({ key }), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    // A connection dropped mid-upload (common on a weak mobile signal with a
    // large file) surfaces here as a generic error — say so plainly rather
    // than showing a confusing stack-trace-flavoured message.
    const message = /network|fetch|aborted|reset|closed/i.test(String(err && err.message))
      ? "The upload connection was interrupted — this usually means a weak or unstable connection. Try again on a stronger signal or Wi-Fi."
      : (err && err.message) || "Upload failed";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: JSON_HEADERS });
  }
};
