// 部屋と謎の定義。状態遷移はここに閉じる。
// 人間は GUI から applyAction を叩き、AI は brief（文章化された状態とヒント集）を読む。

export const SAFE_CODE = "7142";

export function createRoomState() {
  return {
    hasKey: false, // 小さな鍵（引き出し用）
    drawerOpen: false,
    memoRead: false,
    bookRead: false,
    frameChecked: false,
    safeOpen: false,
    hasDoorKey: false,
    escaped: false,
  };
}

// 画面に「AIに『○○』と聞いてみよう」と出すキーワード。進行に応じて増える。
export function visibleKeywords(s) {
  const kw = [];
  if (!s.hasKey) kw.push("鍵のありか");
  if (s.memoRead && !s.bookRead) kw.push("赤い本の数字");
  if (s.memoRead && !s.frameChecked) kw.push("額縁の絵");
  if (s.memoRead && !s.safeOpen) kw.push("金庫の開け方");
  if (!s.hasDoorKey) kw.push("ドアの鍵");
  return kw;
}

// AI が持つヒント集。AI は「聞かれたキーワードの分だけ」答える約束で brief に渡す。
export const HINTS = {
  "鍵のありか": "部屋の隅の観葉植物。鉢の土の中を確かめてみて。",
  "赤い本の数字": "本棚の赤い本、背表紙の数字が金庫のはじめの2桁だよ。",
  "額縁の絵": "額縁の絵の中にあるものを数えてみて。その数が金庫の残りの2桁になるよ。",
  "金庫の開け方":
    "暗証番号は4桁。はじめの2桁は赤い本、残りの2桁は額縁の絵の中。金庫をクリックすると番号を入力できる。",
  "ドアの鍵": "ドアの鍵は金庫の中にある。まず金庫を開けるのが先だね。",
};

// GUI 用のスポット表示（ラベルと状態メモ）
export function spotViews(s) {
  return [
    { id: "door", label: "ドア", note: s.escaped ? "開いた！" : s.hasDoorKey ? "鍵が使えそう" : "固く閉ざされている" },
    { id: "desk", label: "机の引き出し", note: s.drawerOpen ? "開いている" : "鍵がかかっている" },
    { id: "bookshelf", label: "本棚", note: s.bookRead ? "赤い本を調べた" : "本が並んでいる" },
    { id: "plant", label: "観葉植物", note: s.hasKey ? "鉢を調べた" : "部屋の隅にある" },
    { id: "frame", label: "額縁の絵", note: s.frameChecked ? "よく見た" : "壁に掛かっている" },
    { id: "safe", label: "金庫", note: s.safeOpen ? "開いている" : "4桁の暗証番号式" },
  ];
}

export function inventory(s) {
  const items = [];
  if (s.hasKey && !s.drawerOpen) items.push("小さな鍵");
  if (s.memoRead) items.push("メモ");
  if (s.hasDoorKey && !s.escaped) items.push("ドアの鍵");
  return items;
}

// 人間のクリックを処理し、イベント文の配列を返す。
export function applyAction(s, action) {
  const spot = action?.spot;
  const out = [];
  if (s.escaped) return ["もう脱出している。"];
  switch (spot) {
    case "plant":
      if (!s.hasKey) {
        s.hasKey = true;
        out.push("観葉植物の鉢をかき分けると、土の中に小さな鍵が埋まっていた。小さな鍵を手に入れた。");
      } else out.push("観葉植物の鉢。もう何もなさそうだ。");
      break;
    case "desk":
      if (s.drawerOpen) out.push("引き出しは開いている。中にはメモが1枚。");
      else if (!s.hasKey) out.push("引き出しは鍵がかかっていて開かない。");
      else {
        s.drawerOpen = true;
        s.memoRead = true;
        out.push(
          "小さな鍵で引き出しを開けた。中にはメモが1枚。「金庫の暗証番号は4桁。はじめの2桁は本棚の赤い本、あとの2桁は額縁の絵の中」"
        );
      }
      break;
    case "bookshelf":
      if (!s.bookRead) {
        s.bookRead = true;
        out.push("本棚の赤い本を抜き出す。背表紙に大きく「7」「1」と書かれている。");
      } else out.push("赤い本の背表紙には「7」「1」。");
      break;
    case "frame":
      if (!s.frameChecked) {
        s.frameChecked = true;
        out.push("額縁の絵をよく見る。夜空の絵で、星が4つ、鳥が2羽描かれている。");
      } else out.push("額縁の絵。星が4つ、鳥が2羽。");
      break;
    case "safe": {
      if (s.safeOpen) {
        out.push("金庫は開いている。");
        break;
      }
      const code = String(action?.code ?? "");
      if (!code) {
        out.push("金庫は4桁の暗証番号式だ。番号を入力して開けてみよう。");
        break;
      }
      if (code === SAFE_CODE) {
        s.safeOpen = true;
        s.hasDoorKey = true;
        out.push("カチッ、と金庫が開いた。中にドアの鍵が入っていた。ドアの鍵を手に入れた。");
      } else {
        out.push("ピー、とエラー音。暗証番号が違うようだ。");
      }
      break;
    }
    case "door":
      if (s.hasDoorKey) {
        s.escaped = true;
        out.push("ドアの鍵を回すと、ドアが開いた。脱出成功！");
      } else out.push("ドアは固く閉ざされている。鍵が必要だ。");
      break;
    default:
      out.push("何も起きなかった。");
  }
  return out;
}

// AI 向けに状態を文章化する。
export function describeStateForAI(s) {
  const lines = [];
  lines.push(s.hasKey ? "小さな鍵：入手済み" : "小さな鍵：未入手");
  lines.push(s.drawerOpen ? "引き出し：開錠済み（メモ入手済み）" : "引き出し：未開錠");
  lines.push(s.bookRead ? "赤い本：調査済み（背表紙は 7・1）" : "赤い本：未調査");
  lines.push(s.frameChecked ? "額縁の絵：調査済み（星4つ、鳥2羽）" : "額縁の絵：未調査");
  lines.push(s.safeOpen ? "金庫：開錠済み（ドアの鍵入手済み）" : "金庫：未開錠（暗証番号は4桁）");
  lines.push(s.escaped ? "脱出：成功" : "脱出：まだ");
  return lines.join("\n");
}
