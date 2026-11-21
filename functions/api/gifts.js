const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

const KV_MAX_PHOTOS = 12;
const KV_MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const KV_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const R2_MAX_PHOTOS = 20;
const R2_MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const R2_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const TTL_SECONDS = 90 * 24 * 60 * 60;
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS }
  });
}

function randomId(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let output = "";
  for (const byte of bytes) output += ALPHABET[byte % ALPHABET.length];
  return output;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sniff(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function clampText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    const maxPhotos = env.PHOTOS ? R2_MAX_PHOTOS : KV_MAX_PHOTOS;
    const maxPhotoBytes = env.PHOTOS ? R2_MAX_PHOTO_BYTES : KV_MAX_PHOTO_BYTES;
    const maxTotalBytes = env.PHOTOS ? R2_MAX_TOTAL_BYTES : KV_MAX_TOTAL_BYTES;
    if (length > (env.PHOTOS ? 60 : 24) * 1024 * 1024) return json({ error: "payload too large" }, 413);

    const body = await request.json();
    const password = typeof body.password === "string" ? body.password.trim() : "";
    if (password && (password.length < 4 || password.length > 20)) return json({ error: "invalid password" }, 400);

    const photos = Array.isArray(body.photos) ? body.photos.slice(0, maxPhotos) : [];
    if (!photos.length) return json({ error: "no photos" }, 400);

    const decoded = [];
    let total = 0;
    for (const dataUrl of photos) {
      if (typeof dataUrl !== "string") return json({ error: "invalid photo" }, 400);
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) return json({ error: "invalid photo" }, 400);
      const bytes = decodeBase64(match[2]);
      if (bytes.length > maxPhotoBytes) return json({ error: "photo too large" }, 413);
      total += bytes.length;
      if (total > maxTotalBytes) return json({ error: "photos too large" }, 413);
      const type = sniff(bytes);
      if (!type) return json({ error: "invalid image" }, 400);
      decoded.push({ bytes, type, base64: match[2] });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const day = new Date().toISOString().slice(0, 10);
    const rateKey = "rate:" + ip + ":" + day;
    const used = Number(await env.GIFTS.get(rateKey) || 0);
    if (used >= 5) return json({ error: "too many requests" }, 429);
    await env.GIFTS.put(rateKey, String(used + 1), { expirationTtl: 86400 });

    const id = randomId(12);
    const editToken = randomId(40);
    const editHash = await sha256(editToken);
    const captions = Array.isArray(body.captions) ? body.captions : [];

    for (let i = 0; i < decoded.length; i++) {
      if (env.PHOTOS) {
        await env.PHOTOS.put("gifts/" + id + "/" + i, decoded[i].bytes, {
          httpMetadata: { contentType: decoded[i].type, cacheControl: "public, max-age=31536000, immutable" }
        });
      } else {
        await env.GIFTS.put("photo:" + id + ":" + i, JSON.stringify({ t: decoded[i].type, d: decoded[i].base64 }), { expirationTtl: TTL_SECONDS });
      }
    }

    let hasOg = false;
    if (typeof body.og === "string" && body.og) {
      const ogMatch = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.og);
      if (!ogMatch) return json({ error: "invalid og" }, 400);
      const ogBytes = decodeBase64(ogMatch[2]);
      if (ogBytes.length > 1536 * 1024) return json({ error: "og too large" }, 413);
      const ogType = sniff(ogBytes);
      if (!ogType) return json({ error: "invalid og" }, 400);
      if (env.PHOTOS) {
        await env.PHOTOS.put("gifts/" + id + "/og", ogBytes, { httpMetadata: { contentType: ogType, cacheControl: "public, max-age=31536000, immutable" } });
      } else {
        await env.GIFTS.put("photo:" + id + ":og", JSON.stringify({ t: ogType, d: ogMatch[2] }), { expirationTtl: TTL_SECONDS });
      }
      hasOg = true;
    }

    const config = {
      to: clampText(body.to, 24),
      from: clampText(body.from, 32),
      date: clampText(body.date, 20) || "2026.12.25",
      message: clampText(body.message, 120),
      captions: decoded.map((_, i) => clampText(captions[i], 30)),
      photoCount: decoded.length,
      hasOg,
      protected: !!password,
      createdAt: new Date().toISOString()
    };

    await env.GIFTS.put("gift:" + id, JSON.stringify(config), { expirationTtl: TTL_SECONDS });
    await env.GIFTS.put("gift-edit:" + id, editHash, { expirationTtl: TTL_SECONDS });
    if (password) {
      const salt = randomId(16);
      const passwordHash = await sha256(salt + ":" + id + ":" + password);
      await env.GIFTS.put("gift-auth:" + id, JSON.stringify({ salt, hash: passwordHash }), { expirationTtl: TTL_SECONDS });
    }

    const url = new URL("/?g=" + id, request.url).href;
    return json({ id, editToken, url });
  } catch (error) {
    return json({ error: "server error" }, 500);
  }
}
