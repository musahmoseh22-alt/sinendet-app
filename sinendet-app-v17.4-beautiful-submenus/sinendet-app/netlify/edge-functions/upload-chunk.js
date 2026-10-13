import { getStore } from "@netlify/blobs";

const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Each chunk is small (the frontend sends ~2MB pieces) specifically so a
// single request finishes well inside Netlify Edge Functions' response
// timeout even on a slow/weak connection — that timeout, not file size, was
// the real reason large videos were failing (see upload-finalize.js for the
// full explanation). A little headroom above the frontend's own chunk size:
const MAX_CHUNK_BYTES = 6 * 1024 * 1024;

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: JSON_HEADERS });
  }

  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId");
  const index = url.searchParams.get("index");
  if (!uploadId || index === null || index === "") {
    return new Response(JSON.stringify({ error: "Missing uploadId or index" }), { status: 400, headers: JSON_HEADERS });
  }

  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_CHUNK_BYTES) {
      return new Response(JSON.stringify({ error: "Chunk too large" }), { status: 413, headers: JSON_HEADERS });
    }

    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_CHUNK_BYTES) {
      return new Response(JSON.stringify({ error: "Chunk too large" }), { status: 413, headers: JSON_HEADERS });
    }

    const store = getStore("upload-chunks");
    await store.set(`${uploadId}/${index}`, buf);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    const message = /network|fetch|aborted|reset|closed/i.test(String(err && err.message))
      ? "The upload connection was interrupted — this usually means a weak or unstable connection. Try again on a stronger signal or Wi-Fi."
      : (err && err.message) || "Could not save that part of the upload";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: JSON_HEADERS });
  }
};
