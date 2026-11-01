// X Image Downloader - 共通処理(background / content / options で共有)

// Firefox は browser、Chrome/Edge は chrome を使う(どちらも Promise で使える)
var xapi = typeof browser !== "undefined" && browser.runtime ? browser : chrome;
var XID = (() => {
  const TWITTER_EPOCH = 1288834974657n;

  const DEFAULTS = {
    folderTemplate: "Twitter/{YYYY}-{MM}",
    fileTemplate: "{user}-{id}-{index}",
    dateBasis: "tweet", // "tweet" = ツイート投稿日 / "download" = ダウンロード日
    indexStart: 0, // 連番の開始番号 (0 or 1)
    indexPad: 1, // 連番の桁数 (1なら 0,1,2 / 2なら 00,01,02)
    textLength: 30, // {text} の最大文字数
    imageSize: "orig", // orig / 4096x4096 / large / medium / small
    conflict: "uniquify", // uniquify(連番を付ける) / overwrite(上書き) / prompt(確認)
    saveAs: false, // 毎回保存先を聞く
    notify: true, // ページ上に保存結果を表示する
    markSaved: true, // 保存済みツイートのボタンを緑にする
  };

  const IMAGE_SIZES = [
    ["orig", "原寸 (orig)"],
    ["4096x4096", "最大 4096px"],
    ["large", "大 (large)"],
    ["medium", "中 (medium)"],
    ["small", "小 (small)"],
  ];

  // [トークン, 説明, サンプル値]
  const TOKENS = [
    ["{user}", "ユーザーID (@の後ろ)", "username"],
    ["{id}", "ツイートID", "2117123456789012345"],
    ["{index}", "画像の連番 (開始番号・桁数は下で設定)", "0"],
    ["{YYYY}", "年 (4桁)", "2026"],
    ["{MM}", "月 (2桁)", "11"],
    ["{DD}", "日 (2桁)", "02"],
    ["{hh}", "時 (2桁)", "14"],
    ["{mm}", "分 (2桁)", "15"],
    ["{ss}", "秒 (2桁)", "41"],
    ["{text}", "ツイート本文の先頭 (URLは除去)", "サンプルのツイート本文"],
  ];

  function pad(n, w = 2) {
    return String(n).padStart(w, "0");
  }

  // ツイートIDから投稿日時を求める(スノーフレーク)
  function dateFromTweetId(tweetId) {
    try {
      return new Date(Number((BigInt(tweetId) >> 22n) + TWITTER_EPOCH));
    } catch (e) {
      return new Date();
    }
  }

  // Windowsで使えない文字を _ に置き換える
  function cleanValue(s) {
    return String(s).replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_");
  }

  // パスの1区間(フォルダ名/ファイル名)を整える
  function cleanSegment(s) {
    return String(s)
      .replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[\s.]+|[\s.]+$/g, "");
  }

  function makeText(raw, max) {
    const t = String(raw || "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return Array.from(t).slice(0, max).join("");
  }

  function fill(template, vars, unknown) {
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => {
      if (Object.prototype.hasOwnProperty.call(vars, k)) return cleanValue(vars[k]);
      unknown.add(m);
      return m;
    });
  }

  // 保存パス(ダウンロードフォルダからの相対パス)を作る
  // info: { userId, tweetId, index(0始まり), ext, text }
  function buildPath(settings, info, now = new Date()) {
    const d = settings.dateBasis === "download" ? now : dateFromTweetId(info.tweetId);
    const vars = {
      user: info.userId,
      id: info.tweetId,
      index: pad(info.index + settings.indexStart, settings.indexPad),
      YYYY: d.getFullYear(),
      MM: pad(d.getMonth() + 1),
      DD: pad(d.getDate()),
      hh: pad(d.getHours()),
      mm: pad(d.getMinutes()),
      ss: pad(d.getSeconds()),
      text: makeText(info.text, settings.textLength),
    };
    const unknown = new Set();
    const folderRaw = fill(String(settings.folderTemplate).replace(/\\/g, "/"), vars, unknown);
    const folder = folderRaw
      .split("/")
      .map(cleanSegment)
      .filter((s) => s && s !== "." && s !== "..")
      .join("/");
    const file =
      cleanSegment(fill(String(settings.fileTemplate), vars, unknown)) ||
      `${info.userId}-${info.tweetId}-${vars.index}`;
    const name = `${file}.${info.ext}`;
    return {
      path: folder ? `${folder}/${name}` : name,
      unknown: [...unknown],
      hasIndex: /\{index\}/.test(String(settings.folderTemplate) + String(settings.fileTemplate)),
    };
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  async function getSettings() {
    const s = await xapi.storage.sync.get(null);
    // 旧バージョン(1.0)の設定を引き継ぐ
    if (s.dateBasis === undefined && s.monthBasis) s.dateBasis = s.monthBasis;
    const m = { ...DEFAULTS, ...s };
    if (typeof m.folderTemplate !== "string") m.folderTemplate = DEFAULTS.folderTemplate;
    if (typeof m.fileTemplate !== "string" || !m.fileTemplate.trim()) m.fileTemplate = DEFAULTS.fileTemplate;
    m.dateBasis = m.dateBasis === "download" ? "download" : "tweet";
    m.indexStart = Number(m.indexStart) === 1 ? 1 : 0;
    m.indexPad = clampInt(m.indexPad, 1, 6, 1);
    m.textLength = clampInt(m.textLength, 1, 100, 30);
    if (!IMAGE_SIZES.some(([v]) => v === m.imageSize)) m.imageSize = "orig";
    if (!["uniquify", "overwrite", "prompt"].includes(m.conflict)) m.conflict = "uniquify";
    m.saveAs = !!m.saveAs;
    m.notify = !!m.notify;
    m.markSaved = !!m.markSaved;
    return m;
  }

  return { DEFAULTS, IMAGE_SIZES, TOKENS, pad, dateFromTweetId, makeText, buildPath, getSettings };
})();
