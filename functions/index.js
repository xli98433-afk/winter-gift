function esc(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const id = url.searchParams.get("g");
  if (!id) return context.env.ASSETS.fetch(context.request);

  let config = null;
  let auth = false;
  try {
    const raw = await context.env.GIFTS.get("gift:" + id);
    if (raw) config = JSON.parse(raw);
    auth = !!(await context.env.GIFTS.get("gift-auth:" + id)) || !!(config && config.protected);
  } catch (error) {}

  const asset = await context.env.ASSETS.fetch(new URL("/index.html", url));
  let html = await asset.text();

  const title = !config
    ? "礼物不存在"
    : auth
      ? "一份需要访问码的圣诞礼物"
      : config.to
        ? config.to + "，有一棵圣诞树等你拆开"
        : "有一棵圣诞树等你拆开";
  const description = !config
    ? "链接可能已过期。"
    : auth
      ? "输入访问码，拆开这份礼物。"
      : config.message || "张开手掌，让圣诞树散开。";
  const image = config && !auth && config.hasOg
    ? new URL("/api/photos/" + encodeURIComponent(id) + "/og", url).href
    : new URL("/assets/og.png", url).href;
  const canonical = new URL("/?g=" + encodeURIComponent(id), url).href;

  html = html
    .replace(/<title>[\s\S]*?<\/title>/, "<title>" + esc(title) + "</title>")
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(description) + '">')
    .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + esc(title) + '">')
    .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + esc(description) + '">')
    .replace(/<meta property="og:image" content="[^"]*">/, '<meta property="og:image" content="' + esc(image) + '">')
    .replace(/<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="website">\n<meta property="og:url" content="' + esc(canonical) + '">');

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" }
  });
}
