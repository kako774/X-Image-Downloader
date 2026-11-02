// X Image Downloader - content script
// 画像付きツイートのアクションバーに保存ボタンを追加する

const BTN_CLASS = "xid-btn";
const DONE_ATTR = "data-xid-done";
const SAVED_KEY = "savedTweets";

function makeIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18.75");
  svg.setAttribute("height", "18.75");
  svg.setAttribute("aria-hidden", "true");
  // 下向きの矢印と、受け皿(線の太さはXの共有アイコンと同じ2、大きさも同じ3〜21)
  const parts = [
    "M11 3h2v8.6l3.3-3.3 1.4 1.4L12 15.4 6.3 9.7l1.4-1.4 3.3 3.3z",
    "M3 14.5V18a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3.5h-2V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-3.5z",
  ];
  for (const d of parts) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

let cfg = { ...XID.DEFAULTS };
let savedSet = new Set();

// hook.js が拾った動画・GIFの情報(ツイートID -> [{kind, variants}])
const videoMap = new Map();
const VIDEO_MAP_MAX = 1000;

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== "xid-hook" || d.type !== "media") return;
  if (typeof d.tweetId !== "string" || !Array.isArray(d.items)) return;
  videoMap.delete(d.tweetId);
  videoMap.set(d.tweetId, d.items);
  if (videoMap.size > VIDEO_MAP_MAX) videoMap.delete(videoMap.keys().next().value);
  scheduleScan();
});

// 画像URLから「サイズ指定を除いたURL」と拡張子を取り出す
function parseImage(src) {
  try {
    const u = new URL(src);
    if (u.hostname !== "pbs.twimg.com" || !u.pathname.startsWith("/media/")) return null;
    let ext = u.searchParams.get("format");
    const m = u.pathname.match(/\.([a-zA-Z0-9]+)$/);
    if (!ext && m) ext = m[1];
    if (!ext) ext = "jpg";
    ext = ext.toLowerCase();
    if (ext === "jpeg") ext = "jpg";
    const base = "https://pbs.twimg.com" + u.pathname.replace(/\.[a-zA-Z0-9]+$/, "");
    return { base, ext };
  } catch (e) {
    return null;
  }
}

// 記事内で最初の time が本体ツイート(引用ツイートより前に出る)
function getTweetRef(article) {
  const time = article.querySelector("time");
  const a = time && time.closest("a");
  const href = a && a.getAttribute("href");
  const m = href && href.match(/^\/([^/]+)\/status\/(\d+)/);
  return m ? { userId: m[1], tweetId: m[2] } : null;
}

// 画像・動画の目印(Xの画面の作りが変わっても拾えるよう、いくつか並べる)
const MEDIA_SELECTOR = [
  '[data-testid="tweetPhoto"]',
  '[data-testid="videoPlayer"]',
  '[data-testid="videoComponent"]',
  '[data-testid="previewInterstitial"]',
  "video",
].join(",");

function hasMedia(article) {
  if (article.querySelector(MEDIA_SELECTOR)) return true;
  const ref = getTweetRef(article);
  return !!(ref && videoMap.has(ref.tweetId)); // 動画の情報が届いているツイート
}

function getTweetInfo(article) {
  const ref = getTweetRef(article);
  if (!ref) return null;
  const m = [null, ref.userId, ref.tweetId];

  const seen = new Set();
  const images = [];
  article.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img) => {
    const o = parseImage(img.src);
    if (o && !seen.has(o.base)) {
      seen.add(o.base);
      images.push(o);
    }
  });
  const textEl = article.querySelector('[data-testid="tweetText"]');
  const hasVideo = !!article.querySelector('video, [data-testid="videoPlayer"], [data-testid="videoComponent"]') || videoMap.has(m[2]);
  return { userId: m[1], tweetId: m[2], images, hasVideo, text: textEl ? textEl.innerText : "" };
}

// ---- ページ上の通知 ----
let toastTimer = null;
function toast(msg, ok) {
  let t = document.getElementById("xid-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "xid-toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.setAttribute("data-state", ok ? "ok" : "ng");
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

// 保存が終わるまで見守って、終わったらお知らせを出す(失敗したときも出す)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function watchDownloads(ids, what, pathLine) {
  if (!ids.length) return;
  const limit = Date.now() + 10 * 60 * 1000;
  let misses = 0;
  while (Date.now() < limit) {
    await sleep(700);
    let res;
    try {
      res = await xapi.runtime.sendMessage({ type: "check-downloads", ids });
    } catch (e) {
      return; // 拡張機能が更新されたなど
    }
    if (!res || !Array.isArray(res.items)) {
      if (++misses > 3) return;
      continue;
    }
    const bad = res.items.find((d) => d.state === "interrupted");
    if (bad) {
      toast(`${what}の保存に失敗しました${bad.error ? `(${bad.error})` : ""}`, false);
      return;
    }
    if (res.items.length === ids.length && res.items.every((d) => d.state === "complete")) {
      toast(`${what}の保存が完了しました${pathLine}`, true);
      return;
    }
  }
}

function setState(btn, state) {
  btn.setAttribute("data-xid-state", state);
  setTimeout(() => btn.removeAttribute("data-xid-state"), 2000);
}

// ---- 保存済みの表示 ----
function refreshMarks() {
  document.querySelectorAll("." + BTN_CLASS).forEach((btn) => {
    const article = btn.closest("article");
    const info = article && getTweetInfo(article);
    const saved = cfg.markSaved && info && savedSet.has(info.tweetId);
    if (saved) {
      btn.setAttribute("data-xid-saved", "1");
      btn.title = "保存済み(もう一度押すと再保存)";
    } else {
      btn.removeAttribute("data-xid-saved");
      btn.title = "画像・動画を保存";
    }
  });
}

async function loadState() {
  try {
    cfg = await XID.getSettings();
    const { [SAVED_KEY]: list = [] } = await xapi.storage.local.get(SAVED_KEY);
    savedSet = new Set(list);
    refreshMarks();
  } catch (e) {
    /* 拡張機能が更新された直後など。無視 */
  }
}

// 保存ボタンの大きさと縦の位置を、Xの他のアイコン(返信など)に合わせる。
// タイムラインと個別ページ(ツイートを開いた画面)で、Xのアイコンの大きさや行の高さが違うため。
function alignWithBar(btn, bar) {
  if (!btn.isConnected) return;
  const mine = btn.querySelector("svg");
  const ref =
    bar.querySelector('[data-testid="reply"] svg') ||
    [...bar.querySelectorAll("svg")].find((s) => !btn.contains(s));
  if (!mine || !ref) return;
  const r = ref.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return; // まだ画面に配置されていない
  mine.setAttribute("width", String(r.width));
  mine.setAttribute("height", String(r.height));
  // 色もXのアイコンに合わせる(テーマ: ライト/ダークなどで灰色が違うため)
  const col = getComputedStyle(ref).color;
  if (col && !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/.test(col)) btn.style.setProperty("--xid-color", col);
  btn.style.transform = "";
  const m = mine.getBoundingClientRect();
  const dy = r.top + r.height / 2 - (m.top + m.height / 2);
  if (Math.abs(dy) >= 0.5) btn.style.transform = `translateY(${dy}px)`;
}

function scheduleAlign(btn, bar) {
  // 画面の配置が落ち着くまで、何回か合わせ直す
  [0, 250, 1000, 3000].forEach((t) => setTimeout(() => alignWithBar(btn, bar), t));
}

function addButton(article) {
  if (article.getAttribute(DONE_ATTR)) return;
  if (!hasMedia(article)) return;

  const groups = article.querySelectorAll('[role="group"]');
  const bar = groups[groups.length - 1];
  if (!bar) return; // アクションバーがまだ無い。次の監視で再試行

  article.setAttribute(DONE_ATTR, "1");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = BTN_CLASS;
  btn.title = "画像・動画を保存";
  btn.appendChild(makeIcon());
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const info = getTweetInfo(article);
    if (!info) {
      setState(btn, "ng");
      toast("ツイートの情報を読み取れませんでした", false);
      return;
    }
    const videos = videoMap.get(info.tweetId) || [];
    const sendVideos = cfg.saveVideos ? videos : [];
    if (info.images.length === 0 && sendVideos.length === 0) {
      setState(btn, "ng");
      if (info.hasVideo && !cfg.saveVideos) {
        toast("動画の保存がオフになっています(設定画面でオンにできます)", false);
      } else if (info.hasVideo) {
        toast("動画の情報がまだ取得できていません。\nページを再読み込みしてから、もう一度押してください\n(引用ツイートの中の動画には対応していません)", false);
      } else {
        toast("画像が見つかりません", false);
      }
      return;
    }
    try {
      const res = await xapi.runtime.sendMessage({
        type: "download-images",
        userId: info.userId,
        tweetId: info.tweetId,
        text: info.text,
        images: info.images,
        videos: sendVideos,
      });
      if (res && res.total > 0 && res.ok === res.total && res.errors.length === 0) {
        setState(btn, "ok");
        savedSet.add(info.tweetId);
        refreshMarks();
        const parts = [];
        if (res.okImages) parts.push(`画像${res.okImages}枚`);
        if (res.okVideos) parts.push(`動画${res.okVideos}本`);
        const what = parts.join("・");
        const pathLine = cfg.toastPath ? `\n${res.firstPath}` : "";
        if (cfg.notify) {
          toast(`${what}の保存を開始しました${pathLine}`, true);
          watchDownloads(res.ids || [], what, pathLine);
        }
      } else {
        setState(btn, "ng");
        const why = res && res.errors && res.errors[0] ? `\n${res.errors[0]}` : "";
        toast(`保存に失敗しました(${res ? res.ok : 0}/${res ? res.total : 0})${why}`, false);
      }
    } catch (e) {
      setState(btn, "ng");
      toast("拡張機能が更新されました。ページを再読み込みしてください", false);
    }
  });
  bar.appendChild(btn);
  refreshMarks();
  scheduleAlign(btn, bar);
}

function scan() {
  document.querySelectorAll('article[data-testid="tweet"]').forEach(addButton);
}

let scanTimer = null;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 200);
}
new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });

try {
  xapi.storage.onChanged.addListener(loadState);
} catch (e) {
  /* 無視 */
}

loadState();
scan();
