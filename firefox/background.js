// X Image Downloader - background service worker
// Chrome(service worker)では importScripts、Firefox(event page)では manifest の scripts で common.js を読む
if (typeof importScripts === "function") importScripts("common.js");

const SAVED_KEY = "savedTweets";
const SAVED_MAX = 20000;

async function rememberTweet(tweetId) {
  const { [SAVED_KEY]: list = [] } = await xapi.storage.local.get(SAVED_KEY);
  if (list.includes(tweetId)) return;
  list.push(tweetId);
  if (list.length > SAVED_MAX) list.splice(0, list.length - SAVED_MAX);
  await xapi.storage.local.set({ [SAVED_KEY]: list });
}

async function downloadImages({ userId, tweetId, images, text }) {
  const settings = await XID.getSettings();
  const now = new Date();

  let ok = 0;
  let firstPath = "";
  const errors = [];
  for (let i = 0; i < images.length; i++) {
    const { base, ext } = images[i];
    const url = `${base}?format=${ext}&name=${settings.imageSize}`;
    const { path } = XID.buildPath(settings, { userId, tweetId, index: i, ext, text }, now);
    try {
      await xapi.downloads.download({
        url,
        filename: path,
        conflictAction: settings.conflict,
        saveAs: settings.saveAs,
      });
      if (!firstPath) firstPath = path;
      ok++;
    } catch (e) {
      errors.push(String(e && e.message ? e.message : e));
    }
  }
  if (ok === images.length) await rememberTweet(tweetId);
  return { ok, total: images.length, errors, firstPath };
}

xapi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "download-images") {
    downloadImages(msg).then(sendResponse);
    return true; // 非同期で応答
  }
});

// ツールバーのアイコンを押すと設定画面を開く
xapi.action.onClicked.addListener(() => xapi.runtime.openOptionsPage());
