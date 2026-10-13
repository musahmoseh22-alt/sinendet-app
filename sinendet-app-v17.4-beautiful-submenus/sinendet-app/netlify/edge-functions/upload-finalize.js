import { getStore } from "@netlify/blobs";

const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Netlify Edge Functions have a documented 40-second response-header
// timeout per request. A single large video sent in one request has to
// finish transferring (on whatever connection the teacher has) inside that
// window, or it fails — regardless of the memory/size ceiling. That was the
// real cause of "could not fetch" on big videos, not just random bad luck.
// The fix: the frontend splits the file into small pieces (upload-chunk.js
// stores each one on its own, fast, well inside the timeout, with its own
// retry) and this function stitches them back together into one file
// afterwards, once every piece has safely arrived.
const MAX_TOTAL_BYTES = 350 * 1024 * 1024;

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: JSON_HEADERS });
  }

  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId");
  const total = Number(url.searchParams.get("total") || 0);
  const kind = url.searchParams.get("kind") || "file";
  const id = url.searchParams.get("id");
  const contentType = url.searchParams.get("contentType") || "application/octet-stream";

  if (!uploadId || !total || !id) {
    return new Response(JSON.stringify({ error: "Missing uploadId, total or id" }), { status: 400, headers: JSON_HEADERS });
  }

  const chunkStore = getStore("upload-chunks");
  const mediaStore = getStore("media");

  try {
    const parts = [];
    let totalBytes = 0;
    for (let i = 0; i < total; i++) {
      const buf = await chunkStore.get(`${uploadId}/${i}`, { type: "arrayBuffer" });
      if (!buf) {
        return new Response(
          JSON.stringify({ error: `A piece of the upload (${i + 1} of ${total}) didn't arrive — please try uploading again.` }),
          { status: 409, headers: JSON_HEADERS }
        );
      }
      parts.push(buf);
      totalBytes += buf.byteLength;
    }

    if (totalBytes > MAX_TOTAL_BYTES) {
      for (let i = 0; i < total; i++) chunkStore.delete(`${uploadId}/${i}`).catch(() => {});
      return new Response(
        JSON.stringify({ error: `File is larger than the ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB limit` }),
        { status: 413, headers: JSON_HEADERS }
      );
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const part of parts) {
      combined.set(new Uint8Array(part), offset);
      offset += part.byteLength;
    }

    const key = `${id}/${kind}-${crypto.randomUUID()}`;
    await mediaStore.set(key, combined, { metadata: { contentType } });

    // Clean up the temporary pieces — best effort, doesn't block the response.
    for (let i = 0; i < total; i++) chunkStore.delete(`${uploadId}/${i}`).catch(() => {});

    return new Response(JSON.stringify({ key }), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err && err.message) || "Could not finish putting the upload together — please try again." }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
