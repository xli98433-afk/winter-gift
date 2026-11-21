const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

let secretCache = "";

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    secret = Array.from(bytes, byte => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[byte % 62]).join("");
    await env.GIFTS.put("config:secret", secret);
  }
  secretCache = secret;
  return secret;
}

function valid(id, slot) {
  return /^[A-Za-z0-9]{6,32}$/.test(id) && (/^\d{1,2}$/.test(slot) || slot === "og");
}

async function authorized(env, request, id, slot) {
  const auth = await env.GIFTS.get("gift-auth:" + id);
  if (!auth) {
    const raw = await env.GIFTS.get("gift:" + id);
    let protectedGift = false;
    if (raw) { try { protectedGift = !!JSON.parse(raw).protected; } catch (error) {} }
    return !protectedGift;
  }
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("e") || 0);
  const signature = url.searchParams.get("s") || "";
  if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
  const secret = await getSecret(env);
  const expected = await hmacHex(secret, id + ":" + slot + ":" + exp);
  return safeEqual(signature, expected);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ params, request, env }) {
  const id = String(params.id || "");
  const slot = String(params.slot || "");
  if (!valid(id, slot)) return new Response("Not found", { status: 404, headers: CORS });
  if (!(await authorized(env, request, id, slot))) return new Response("Forbidden", { status: 401, headers: CORS });

  if (env.PHOTOS) {
    const object = await env.PHOTOS.get("gifts/" + id + "/" + slot);
    if (!object) return new Response("Not found", { status: 404, headers: CORS });
    return new Response(object.body, {
      headers: {
        "Content-Type": (object.httpMetadata && object.httpMetadata.contentType) || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": object.httpEtag,
        ...CORS
      }
    });
  }

  const raw = await env.GIFTS.get("photo:" + id + ":" + slot);
  if (!raw) return new Response("Not found", { status: 404, headers: CORS });
  let meta;
  try { meta = JSON.parse(raw); } catch (error) { return new Response("Not found", { status: 404, headers: CORS }); }
  const bytes = decodeBase64(meta.d || "");
  return new Response(bytes, {
    headers: {
      "Content-Type": meta.t || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      ...CORS
    }
  });
}

export async function onRequestHead({ params, request, env }) {
  const id = String(params.id || "");
  const slot = String(params.slot || "");
  if (!valid(id, slot)) return new Response(null, { status: 404, headers: CORS });
  if (!(await authorized(env, request, id, slot))) return new Response(null, { status: 401, headers: CORS });

  if (env.PHOTOS) {
    const object = await env.PHOTOS.head("gifts/" + id + "/" + slot);
    if (!object) return new Response(null, { status: 404, headers: CORS });
    return new Response(null, {
      headers: {
        "Content-Type": (object.httpMetadata && object.httpMetadata.contentType) || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": object.httpEtag,
        ...CORS
      }
    });
  }

  const raw = await env.GIFTS.get("photo:" + id + ":" + slot);
  if (!raw) return new Response(null, { status: 404, headers: CORS });
  let meta;
  try { meta = JSON.parse(raw); } catch (error) { return new Response(null, { status: 404, headers: CORS }); }
  return new Response(null, {
    headers: {
      "Content-Type": meta.t || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      ...CORS
    }
  });
}
