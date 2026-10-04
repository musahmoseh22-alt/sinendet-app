import { getStore } from "@netlify/blobs";

const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_BYTES = 300 * 1024 * 1024; // 300MB — safe ceiling given the Edge Function's 512MB memory limit

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
    const contentType = request.headers.get("content-type") || "application/octet-stream";
    const buf = await request.arrayBuffer();

    if (buf.byteLength > MAX_BYTES) {
      return new Response(
        JSON.stringify({ error: `File is larger than the ${MAX_BYTES / 1024 / 1024}MB limit` }),
        { status: 413, headers: JSON_HEADERS }
      );
    }

    const store = getStore("media");
    const key = `${id}/${kind}-${crypto.randomUUID()}`;
    await store.set(key, buf, { metadata: { contentType } });

    return new Response(JSON.stringify({ key }), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: JSON_HEADERS });
  }
};
