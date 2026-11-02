// X Image Downloader - background service worker
// Chrome(service worker)では importScripts、Firefox(event page)では manifest の scripts で common.js を読む
if (typeof importScripts === "function") importScripts("common.js");

const SAVED_KEY = "savedTweets";
const SAVED_MAX = 20000;

const IMAGE_HOST = "pbs.twimg.com";
const VIDEO_HOST = "video.twimg.com";

async function rememberTweet(tweetId) {
  const { [SAVED_KEY]: list = [] } = await xapi.storage.local.get(SAVED_KEY);
  if (list.includes(tweetId)) return;
  list.push(tweetId);
  if (list.length > SAVED_MAX) list.splice(0, list.length - SAVED_MAX);
  await xapi.storage.local.set({ [SAVED_KEY]: list });
}

// 保存するファイルの一覧(URL・拡張子・種類)を作る
function buildJobs(settings, { images, videos }) {
  const jobs = [];
  const errors = [];

  for (const img of Array.isArray(images) ? images : []) {
    const base = img && img.base;
    if (typeof base !== "string" || !base.startsWith(`https://${IMAGE_HOST}/media/`)) {
      errors.push("画像のURLが不正です");
      continue;
    }
    jobs.push({
      kind: "image",
      url: `${base}?format=${img.ext}&name=${settings.imageSize}`,
      ext: String(img.ext || "jpg"),
    });
  }

  if (settings.saveVideos) {
    for (const v of Array.isArray(videos) ? videos : []) {
      const pick = XID.pickVideoVariant(v && v.variants, settings.videoQuality);
      if (!pick) {
        errors.push("保存できるMP4が見つかりません(この動画はMP4の配信がありません)");
        continue;
      }
      if (!XID.isAllowedUrl(pick.url, VIDEO_HOST)) {
        errors.push("動画のURLが不正です");
        continue;
      }
      jobs.push({ kind: "video", url: pick.url, ext: "mp4" });
    }
  }
  return { jobs, errors };
}

async function downloadMedia({ userId, tweetId, images, videos, text }) {
  const settings = await XID.getSettings();
  const now = new Date();
  const { jobs, errors } = buildJobs(settings, { images, videos });

  let okImages = 0;
  let okVideos = 0;
  let firstPath = "";
  const ids = []; // 開始したダウンロードのID(完了の確認に使う)
  const counter = { image: 0, video: 0 }; // 種類ごとの連番

  for (const job of jobs) {
    const index = counter[job.kind]++;
    const { path } = XID.buildPath(settings, { userId, tweetId, index, ext: job.ext, text }, now);
    try {
      const id = await xapi.downloads.download({
        url: job.url,
        filename: path,
        conflictAction: settings.conflict,
        saveAs: settings.saveAs,
      });
      if (!firstPath) firstPath = path;
      ids.push(id);
      if (job.kind === "image") okImages++;
      else okVideos++;
    } catch (e) {
      errors.push(String(e && e.message ? e.message : e));
    }
  }

  const total = jobs.length;
  const ok = okImages + okVideos;
  if (total > 0 && ok === total && errors.length === 0) await rememberTweet(tweetId);
  return { ok, total, okImages, okVideos, errors, firstPath, ids };
}

// ダウンロードの状態(complete / in_progress / interrupted)を調べる。状態は持たず、毎回ブラウザに聞く。
async function checkDownloads(ids) {
  const list = (Array.isArray(ids) ? ids : []).filter((n) => Number.isInteger(n)).slice(0, 50);
  const items = [];
  for (const id of list) {
    const found = await xapi.downloads.search({ id });
    for (const d of found || []) items.push({ id: d.id, state: d.state, error: d.error || "" });
  }
  return { items };
}

xapi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "download-images") {
    downloadMedia(msg).then(sendResponse);
    return true; // 非同期で応答
  }
  if (msg && msg.type === "check-downloads") {
    checkDownloads(msg.ids).then(sendResponse, () => sendResponse({ items: null }));
    return true;
  }
});

// ツールバーのアイコンを押すと設定画面を開く
xapi.action.onClicked.addListener(() => xapi.runtime.openOptionsPage());
