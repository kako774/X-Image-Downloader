const $ = (id) => document.getElementById(id);

const SAMPLE = {
  userId: "username",
  tweetId: "2117123456789012345",
  text: "サンプルのツイート本文 https://t.co/xxxxxxxx",
};

let lastText = $("folderTemplate"); // トークンを挿入する入力欄
let saveTimer = null;

// ---- フォーム <-> 設定 ----
function read() {
  return {
    folderTemplate: $("folderTemplate").value,
    fileTemplate: $("fileTemplate").value,
    dateBasis: document.querySelector('input[name="dateBasis"]:checked').value,
    indexStart: Number($("indexStart").value),
    indexPad: Number($("indexPad").value),
    textLength: Number($("textLength").value) || XID.DEFAULTS.textLength,
    imageSize: $("imageSize").value,
    conflict: $("conflict").value,
    saveAs: $("saveAs").checked,
    notify: $("notify").checked,
    markSaved: $("markSaved").checked,
  };
}

function write(s) {
  $("folderTemplate").value = s.folderTemplate;
  $("fileTemplate").value = s.fileTemplate;
  document.querySelectorAll('input[name="dateBasis"]').forEach((r) => (r.checked = r.value === s.dateBasis));
  $("indexStart").value = String(s.indexStart);
  $("indexPad").value = String(Math.min(3, s.indexPad));
  $("textLength").value = s.textLength;
  $("imageSize").value = s.imageSize;
  $("conflict").value = s.conflict;
  $("saveAs").checked = s.saveAs;
  $("notify").checked = s.notify;
  $("markSaved").checked = s.markSaved;
}

// ---- プレビュー ----
function esc(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function renderPreview() {
  const s = read();
  const samples = [
    { ...SAMPLE, index: 0, ext: "jpg" },
    { ...SAMPLE, index: 1, ext: "jpg" },
  ];
  const results = samples.map((info) => XID.buildPath(s, info));
  const pv = $("preview");
  pv.textContent = "";
  const head = document.createElement("div");
  head.className = "dim";
  head.textContent = "保存されるファイルの例(画像2枚のツイート)";
  pv.appendChild(head);
  results.forEach((r) => {
    const row = document.createElement("div");
    row.textContent = "ダウンロード/" + r.path.replace(/\//g, "\\");
    pv.appendChild(row);
  });

  const warns = [];
  const unknown = results[0].unknown;
  if (unknown.length) warns.push(`使えない項目があります: ${unknown.join(" ")}`);
  if (!results[0].hasIndex) warns.push("{index} が入っていないので、複数枚のツイートで同じ名前になります(「同じ名前のファイルがあるとき」の設定に従います)");
  $("warn").textContent = warns.join(" / ");
}

// ---- 保存 ----
function onChange() {
  renderPreview();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await xapi.storage.sync.set(read());
    flashSaved("保存しました");
  }, 300);
}

function flashSaved(msg) {
  $("saved").textContent = msg;
  setTimeout(() => ($("saved").textContent = ""), 1500);
}

async function updateHistoryCount() {
  const { savedTweets = [] } = await xapi.storage.local.get("savedTweets");
  $("historyCount").textContent = `(現在 ${savedTweets.length} 件)`;
}

// ---- 初期化 ----
async function init() {
  // 画像サイズの選択肢
  XID.IMAGE_SIZES.forEach(([v, label]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    $("imageSize").appendChild(o);
  });

  // トークンのボタンと一覧表
  XID.TOKENS.forEach(([tok, desc, sample]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = tok;
    b.title = desc;
    // クリックで入力欄からフォーカスが外れないようにする
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => insertToken(tok));
    $("chips").appendChild(b);

    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.textContent = tok;
    const td2 = document.createElement("td");
    td2.append(desc, document.createElement("br"), "例: " + sample);
    tr.append(td1, td2);
    $("tokenTable").appendChild(tr);
  });

  write(await XID.getSettings());
  renderPreview();
  updateHistoryCount();

  ["folderTemplate", "fileTemplate"].forEach((id) =>
    $(id).addEventListener("focus", (e) => (lastText = e.target))
  );
  document.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("input", onChange);
    el.addEventListener("change", onChange);
  });

  $("reset").addEventListener("click", async () => {
    if (!confirm("設定を初期値に戻しますか?")) return;
    await xapi.storage.sync.clear();
    write({ ...XID.DEFAULTS });
    renderPreview();
    flashSaved("初期値に戻しました");
  });

  $("clearHistory").addEventListener("click", async () => {
    if (!confirm("保存済みの記録を消しますか?(ダウンロードしたファイルは消えません)")) return;
    await xapi.storage.local.remove("savedTweets");
    updateHistoryCount();
    flashSaved("消しました");
  });
}

function insertToken(tok) {
  const el = lastText;
  el.focus();
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + tok + el.value.slice(end);
  const pos = start + tok.length;
  el.setSelectionRange(pos, pos);
  onChange();
}

init();
