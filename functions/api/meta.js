const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const r2 = !!env.PHOTOS;
  return json({
    storage: r2 ? "r2" : "kv",
    maxPhotos: r2 ? 20 : 12,
    maxEdge: r2 ? 1600 : 1280,
    maxPhotoBytes: r2 ? 4 * 1024 * 1024 : 2 * 1024 * 1024,
    maxTotalBytes: r2 ? 40 * 1024 * 1024 : 12 * 1024 * 1024
  });
}
