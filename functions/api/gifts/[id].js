const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gift-Password",
  "Access-Control-Max-Age": "86400"
};

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
let secretCache = "";

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

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function getSecret(env) {
  if (secretCache) return secretCache;
  let secret = await env.GIFTS.get("config:secret");
  if (!secret) {
    secret = randomId(48);
    await env.GIFTS.put("config:secret", secret);
  }
  secretCache = secret;
  return secret;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ params, request, env }) {
  const id = String(params.id || "");
  if (!/^[A-Za-z0-9]{6,32}$/.test(id)) return json({ error: "not found" }, 404);
  const raw = await env.GIFTS.get("gift:" + id);
  if (!raw) return json({ error: "not found" }, 404);
  let config;
  try { config = JSON.parse(raw); } catch (error) { return json({ error: "not found" }, 404); }

  const authRaw = await env.GIFTS.get("gift-auth:" + id);
  const protectedGift = !!config.protected || !!authRaw;
  let signed = false;
  if (protectedGift) {
    if (!authRaw) return json({ protected: true, error: "password required" }, 401);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const tryKey = "try:" + id + ":" + ip;
    const tries = Number(await env.GIFTS.get(tryKey) || 0);
    if (tries >= 30) return json({ error: "too many requests" }, 429);
    const fail = async () => { await env.GIFTS.put(tryKey, String(tries + 1), { expirationTtl: 3600 }); };

    const password = request.headers.get("X-Gift-Password") || "";
    if (!password) { await fail(); return json({ protected: true, error: "password required" }, 401); }
    let auth;
    try { auth = JSON.parse(authRaw); } catch (error) { return json({ protected: true, error: "password required" }, 401); }
    const hash = await sha256(auth.salt + ":" + id + ":" + password);
    if (!safeEqual(hash, auth.hash)) { await fail(); return json({ protected: true, error: "invalid password" }, 401); }
    signed = true;
  }

  const photos = [];
  const total = Number(config.photoCount) || 0;
  if (signed) {
    const secret = await getSecret(env);
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    for (let i = 0; i < total; i++) {
      const url = new URL("/api/photos/" + id + "/" + i, request.url);
      url.searchParams.set("e", String(exp));
      url.searchParams.set("s", await hmacHex(secret, id + ":" + i + ":" + exp));
      photos.push(url.href);
    }
  } else {
    for (let i = 0; i < total; i++) {
      photos.push(new URL("/api/photos/" + id + "/" + i, request.url).href);
    }
  }

  return json({
    to: config.to || "",
    from: config.from || "",
    date: config.date || "",
    message: config.message || "",
    captions: Array.isArray(config.captions) ? config.captions : [],
    photos,
    protected: protectedGift,
    hasOg: !!config.hasOg
  });
}

export async function onRequestDelete({ params, request, env }) {
  const id = String(params.id || "");
  if (!/^[A-Za-z0-9]{6,32}$/.test(id)) return json({ error: "not found" }, 404);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "forbidden" }, 403);
  const stored = await env.GIFTS.get("gift-edit:" + id);
  if (!stored) return json({ error: "not found" }, 404);
  const hash = await sha256(token);
  if (hash !== stored) return json({ error: "forbidden" }, 403);

  if (env.PHOTOS) {
    const list = await env.PHOTOS.list({ prefix: "gifts/" + id + "/" });
    if (list.objects.length) {
      await env.PHOTOS.delete(list.objects.map(object => object.key));
    }
  }
  const photos = await env.GIFTS.list({ prefix: "photo:" + id + ":" });
  if (photos.keys.length) {
    await env.GIFTS.delete(photos.keys.map(key => key.name));
  }
  await env.GIFTS.delete("gift:" + id);
  await env.GIFTS.delete("gift-edit:" + id);
  await env.GIFTS.delete("gift-auth:" + id);
  return new Response(null, { status: 204, headers: CORS });
}
