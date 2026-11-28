let maxPhotos = 12;
let maxEdge = 1280;
const QUALITY = 0.82;

const $ = id => document.getElementById(id);
const toInput = $("to");
const fromInput = $("from");
const dateInput = $("date");
const messageInput = $("message");
const passwordInput = $("password");
const grid = $("grid");
const countEl = $("count");
const photoInput = $("photoInput");
const previewBtn = $("previewBtn");
const publishBtn = $("publishBtn");
const resultModal = $("result");
const resultUrl = $("resultUrl");
const resultNote = $("resultNote");
const toastEl = $("toast");

let items = [];
let toastTimer = 0;
let busy = false;

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}

function payload() {
  return {
    to: toInput.value.trim(),
    from: fromInput.value.trim(),
    date: dateInput.value.trim() || "2026.12.25",
    message: messageInput.value.trim(),
    password: passwordInput.value.trim(),
    captions: items.map(item => item.caption.trim()),
    photos: items.map(item => item.dataUrl)
  };
}

async function compress(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  return canvas.toDataURL("image/jpeg", QUALITY);
}

async function addFiles(files) {
  const room = maxPhotos - items.length;
  const chosen = Array.from(files).slice(0, Math.max(0, room));
  if (!chosen.length) {
    toast("最多 " + maxPhotos + " 张照片");
    return;
  }
  busy = true;
  publishBtn.disabled = true;
  toast("正在处理照片…");
  for (const file of chosen) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const dataUrl = await compress(file);
      items.push({ dataUrl, caption: "" });
    } catch (error) {
      toast("有照片格式不支持，请换 JPG/PNG");
    }
  }
  busy = false;
  publishBtn.disabled = false;
  render();
  saveMeta();
}

function render() {
  grid.innerHTML = "";
  items.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "photo";
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.style.backgroundImage = "url('" + item.dataUrl + "')";
    const caption = document.createElement("input");
    caption.className = "caption";
    caption.type = "text";
    caption.maxLength = 24;
    caption.placeholder = "这张照片想说什么？";
    caption.value = item.caption;
    caption.addEventListener("input", () => { item.caption = caption.value; saveMeta(); });
    const tools = document.createElement("div");
    tools.className = "tools";
    const up = document.createElement("button");
    up.textContent = "↑";
    up.title = "前移";
    up.disabled = index === 0;
    up.addEventListener("click", () => move(index, -1));
    const down = document.createElement("button");
    down.textContent = "↓";
    down.title = "后移";
    down.disabled = index === items.length - 1;
    down.addEventListener("click", () => move(index, 1));
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.title = "删除";
    remove.addEventListener("click", () => { items.splice(index, 1); render(); saveMeta(); });
    tools.append(up, down, remove);
    card.append(thumb, caption, tools);
    grid.appendChild(card);
  });
  countEl.textContent = items.length + " / " + maxPhotos;
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= items.length) return;
  const temp = items[index];
  items[index] = items[target];
  items[target] = temp;
  render();
  saveMeta();
}

function saveMeta() {
  try {
    localStorage.setItem("gift-meta", JSON.stringify({
      to: toInput.value,
      from: fromInput.value,
      date: dateInput.value,
      message: messageInput.value
    }));
  } catch (error) {}
}

function loadMeta() {
  try {
    const meta = JSON.parse(localStorage.getItem("gift-meta") || "null");
    if (!meta) return;
    if (meta.to) toInput.value = meta.to;
    if (meta.from) fromInput.value = meta.from;
    if (meta.date) dateInput.value = meta.date;
    if (meta.message) messageInput.value = meta.message;
  } catch (error) {}
}

function openResult(url, note) {
  resultUrl.value = url;
  resultNote.textContent = note;
  $("openBtn").href = url;
  const qr = $("qrcode");
  qr.innerHTML = "";
  if (window.QRCode) {
    try {
      new QRCode(qr, {
        text: url,
        width: 180,
        height: 180,
        colorDark: "#0a0d14",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (error) {}
  }
  resultModal.classList.remove("hidden");
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(resultUrl.value);
    toast("链接已复制");
  } catch (error) {
    resultUrl.select();
    document.execCommand("copy");
    toast("链接已复制");
  }
}

function localPreview() {
  if (!items.length) {
    toast("先添加至少一张照片");
    return;
  }
  try {
    localStorage.setItem("gift-draft", JSON.stringify(payload()));
  } catch (error) {
    toast("照片太大，换几张再试");
    return;
  }
  window.open("index.html?preview=1", "_blank");
}

function mockPublish() {
  const id = "local-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  try {
    localStorage.setItem("gift:" + id, JSON.stringify(payload()));
  } catch (error) {
    toast("照片太大，换几张再试");
    return;
  }
  const url = new URL("index.html?g=" + encodeURIComponent(id) + "&mock=1", location.href).href;
  openResult(url, "本地演示链接：仅这台电脑的当前浏览器能打开。部署后端后会生成可分享的正式链接。");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function makeOgImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  const background = ctx.createRadialGradient(600, 220, 60, 600, 360, 820);
  background.addColorStop(0, "#17121d");
  background.addColorStop(1, "#05070d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!passwordInput.value.trim() && items[0]) {
    try {
      const image = await loadImage(items[0].dataUrl);
      const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.globalAlpha = 0.34;
      ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      ctx.globalAlpha = 1;
      const shade = ctx.createLinearGradient(0, 0, 0, canvas.height);
      shade.addColorStop(0, "rgba(5,7,13,0.55)");
      shade.addColorStop(0.55, "rgba(5,7,13,0.7)");
      shade.addColorStop(1, "rgba(5,7,13,0.92)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } catch (error) {}
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#f4d089";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "10px";
  ctx.font = "400 52px Georgia, serif";
  ctx.fillText("MERRY CHRISTMAS", 600, 118, 1040);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "4px";
  try { await document.fonts.load('400 86px "Zhi Mang Xing"', "给"); } catch (error) {}
  ctx.font = '400 86px "Zhi Mang Xing", "KaiTi", serif';
  ctx.fillStyle = "#f7e6bb";
  const recipient = toInput.value.trim();
  const centerText = recipient ? "给 " + recipient : (messageInput.value.trim() || "圣诞快乐");
  ctx.fillText(centerText, 600, 300, 1000);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "6px";
  ctx.font = "400 30px Georgia, serif";
  ctx.fillStyle = "rgba(247,241,227,0.72)";
  ctx.fillText(dateInput.value.trim() || "2026.12.25", 600, 392);
  const sender = fromInput.value.trim();
  if (sender) {
    ctx.fillStyle = "rgba(244,208,137,0.66)";
    ctx.font = "400 26px Georgia, serif";
    ctx.fillText("—— " + sender, 600, 446, 900);
  }
  if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
  ctx.font = "400 20px Georgia, serif";
  ctx.fillStyle = "rgba(244,208,137,0.48)";
  ctx.fillText("点击照片，听它说话", 600, 560);
  return canvas.toDataURL("image/jpeg", 0.86);
}

async function publish() {
  if (busy) return;
  if (!items.length) {
    toast("先添加至少一张照片");
    return;
  }
  const accessCode = passwordInput.value.trim();
  if (accessCode && accessCode.length < 4) {
    toast("访问码至少 4 位");
    return;
  }
  publishBtn.disabled = true;
  previewBtn.disabled = true;
  toast("正在生成链接…");
  const data = payload();
  try { data.og = await makeOgImage(); } catch (error) {}
  const body = JSON.stringify(data);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("/api/gifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (!data || !data.id) throw new Error("invalid response");
    if (data.editToken) {
      try { localStorage.setItem("gift-edit:" + data.id, data.editToken); } catch (error) {}
    }
    const url = data.url || new URL("?g=" + encodeURIComponent(data.id), location.href).href;
    const pw = passwordInput.value.trim();
    openResult(url, "链接 90 天内有效。" + (pw ? "访问码：" + pw + "（请单独发给对方）" : "转发时只发这一个链接。"));
  } catch (error) {
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (local) {
      mockPublish();
    } else {
      toast("发布失败，请稍后再试");
      console.error(error);
    }
  } finally {
    clearTimeout(timer);
    publishBtn.disabled = false;
    previewBtn.disabled = false;
  }
}

$("addPhotos").addEventListener("click", () => photoInput.click());
photoInput.addEventListener("change", event => {
  addFiles(event.target.files || []);
  event.target.value = "";
});
previewBtn.addEventListener("click", localPreview);
publishBtn.addEventListener("click", publish);
$("copyBtn").addEventListener("click", copyLink);
$("closeResult").addEventListener("click", () => resultModal.classList.add("hidden"));
[toInput, fromInput, dateInput, messageInput].forEach(input => input.addEventListener("change", saveMeta));

async function loadLimits() {
  try {
    const response = await fetch("/api/meta", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json();
    if (Number(data.maxPhotos) > 0) maxPhotos = Number(data.maxPhotos);
    if (Number(data.maxEdge) > 0) maxEdge = Number(data.maxEdge);
    render();
  } catch (error) {}
}

loadMeta();
render();
loadLimits();
