// X Image Downloader - hook.js (ページ本体と同じ空間で動く)
// Xのページが自分で読み込むデータ(タイムラインなどのJSON)を横から覗いて、
// 動画・GIFのMP4のURLを集め、拡張機能の本体(content.js)へ渡す。
// ログイン情報や認証ヘッダーには触れない。通信を増やすこともしない。
(() => {
  if (window.__xidHooked) return;
  window.__xidHooked = true;

  const API_RE = /\/i\/api\/(graphql|1\.1|2)\//;
  const sent = new Set(); // 同じ内容を何度も送らない

  // JSONの中から「動画・GIFを含むツイート」を探す
  function collect(root) {
    const found = [];
    const stack = [root];
    let guard = 0;
    while (stack.length && guard++ < 300000) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      if (Array.isArray(o)) {
        for (let i = 0; i < o.length; i++) stack.push(o[i]);
        continue;
      }
      let id = null;
      let legacy = null;
      if (o.rest_id && o.legacy && typeof o.legacy === "object") {
        id = o.rest_id;
        legacy = o.legacy;
      } else if (o.id_str && o.extended_entities) {
        id = o.id_str;
        legacy = o;
      }
      if (id && legacy) {
        const media =
          (legacy.extended_entities && legacy.extended_entities.media) ||
          (legacy.entities && legacy.entities.media) ||
          [];
        const items = [];
        for (const m of media) {
          if (
            m &&
            (m.type === "video" || m.type === "animated_gif") &&
            m.video_info &&
            Array.isArray(m.video_info.variants)
          ) {
            items.push({
              kind: m.type === "animated_gif" ? "gif" : "video",
              variants: m.video_info.variants
                .filter((v) => v && typeof v.url === "string")
                .map((v) => ({
                  url: v.url,
                  bitrate: Number(v.bitrate) || 0,
                  content_type: v.content_type || "",
                })),
            });
          }
        }
        if (items.length) found.push({ tweetId: String(id), items });
      }
      for (const k in o) {
        const v = o[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
    return found;
  }

  function handleText(text) {
    if (typeof text !== "string" || !text.includes("video_info")) return;
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return;
    }
    for (const f of collect(json)) {
      const key = f.tweetId + ":" + f.items.map((i) => i.variants.length).join(",");
      if (sent.has(key)) continue;
      sent.add(key);
      window.postMessage({ source: "xid-hook", type: "media", tweetId: f.tweetId, items: f.items }, location.origin);
    }
  }

  // fetch を見張る
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      try {
        const a0 = args[0];
        const url = typeof a0 === "string" ? a0 : a0 && a0.url ? a0.url : String(a0 || "");
        if (API_RE.test(url)) {
          p.then((res) => {
            try {
              res.clone().text().then(handleText).catch(() => {});
            } catch (e) {
              /* 無視 */
            }
          }).catch(() => {});
        }
      } catch (e) {
        /* 無視 */
      }
      return p;
    };
  }

  // XMLHttpRequest を見張る
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (API_RE.test(String(url))) {
        this.addEventListener("load", () => {
          try {
            if (this.responseType === "" || this.responseType === "text") handleText(this.responseText);
          } catch (e) {
            /* 無視 */
          }
        });
      }
    } catch (e) {
      /* 無視 */
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
