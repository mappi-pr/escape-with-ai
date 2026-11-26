// 部屋と謎の定義。状態遷移はここに閉じる。
// 人間は GUI から applyAction を叩き、AI は brief（文章化された状態とヒント集）を読む。

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// 脱出キーワードの候補。クリア後に画面へ表示され、プレイヤーが AI に
// この言葉を話しかけると、AI からお祝いが届く仕掛け。
const CLEAR_WORDS = ["あさひ", "ほしぞら", "ゆめ", "かぜ", "うみ", "つき", "はな", "そら"];

export function createRoomState() {
  // 暗証番号と手がかりの数字はセッションごとにランダム。
  // 同じ答えの使い回しで突破できないようにする。
  const bookA = randInt(0, 9);
  const bookB = randInt(0, 9);
  const stars = randInt(2, 6);
  const birds = randInt(2, 5);
  return {
    hasKey: false, // 小さな鍵（引き出し用）
    drawerOpen: false,
    memoRead: false,
    bookRead: false,
    frameChecked: false,
    safeOpen: false,
    safeFails: 0, // 金庫の入力ミス回数（総当たり封じのロック判定用）
    safeLockedUntil: 0, // 金庫ロックの解除時刻（ms）。0 はロックされていない
    hasDoorKey: false,
    escaped: false,
    clearWord: CLEAR_WORDS[randInt(0, CLEAR_WORDS.length - 1)],
    celebrated: false,
    // このセッションの答え
    bookA,
    bookB,
    stars,
    birds,
    safeCode: `${bookA}${bookB}${stars}${birds}`,
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
  "額縁の絵": "額縁の絵の中にある星と鳥の数が、金庫の残りの2桁になるよ。画面の絵だけでは数えきれないけど、状態（brief）を取得すれば正確な数が分かるよ。",
  "金庫の開け方":
    "暗証番号は4桁。はじめの2桁は赤い本の背表紙、あとの2桁は額縁の絵の星と鳥の数だよ（この組み立て方は画面のメモには書かれていなくて、相方だけが知っている）。金庫をクリックすると番号を入力できる。3回間違えると1分ほどロックされるから気をつけて。",
  "ドアの鍵": "ドアの鍵は金庫の中にある。まず金庫を開けるのが先だね。",
};

// GUI 用のスポット表示（ラベル・状態メモ・バッジ・調査済みフラグ）
export function spotViews(s) {
  return [
    { id: "door", label: "ドア", note: s.escaped ? "開いた！" : s.hasDoorKey ? "鍵が使えそう" : "固く閉ざされている", badge: s.escaped ? "脱出！" : s.hasDoorKey ? "鍵が使える" : "鍵が必要", done: s.escaped },
    { id: "desk", label: "机の引き出し", note: s.drawerOpen ? "開いている" : "鍵がかかっている", badge: s.drawerOpen ? "調べた" : "鍵がかかっている", done: s.drawerOpen },
    { id: "bookshelf", label: "本棚", note: s.bookRead ? "赤い本を調べた" : "本が並んでいる", badge: s.bookRead ? "調べた" : "", done: s.bookRead },
    { id: "plant", label: "観葉植物", note: s.hasKey ? "鉢を調べた" : "部屋の隅にある", badge: s.hasKey ? "調べた" : "", done: s.hasKey },
    { id: "frame", label: "額縁の絵", note: s.frameChecked ? "よく見た" : "壁に掛かっている", badge: s.frameChecked ? "調べた" : "", done: s.frameChecked },
    { id: "safe", label: "金庫", note: s.safeOpen ? "開いている" : s.safeLockedUntil && Date.now() < s.safeLockedUntil ? "ロック中" : "4桁の暗証番号式", badge: s.safeOpen ? "開いた" : s.safeLockedUntil && Date.now() < s.safeLockedUntil ? "ロック中" : "番号で開ける", done: s.safeOpen },
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
          "小さな鍵で引き出しを開けた。中にはメモが1枚。「金庫の暗証番号は4桁。組み立て方は、相方に聞いて」"
        );
      }
      break;
    case "bookshelf":
      if (!s.bookRead) {
        s.bookRead = true;
        out.push(`本棚の赤い本を抜き出す。背表紙に大きく「${s.bookA}」「${s.bookB}」と書かれている。`);
      } else out.push(`赤い本の背表紙には「${s.bookA}」「${s.bookB}」。`);
      break;
    case "frame":
      // 画面の絵からは正確な数を読み取れない（星も鳥もたくさんいる）。
      // 正確な数は AI が brief の状態で知る。プレイヤーが相方に聞く流れを作るため。
      if (!s.frameChecked) {
        s.frameChecked = true;
        out.push("額縁の絵をよく見る。夜空の絵だ。星がたくさん瞬き、鳥の群れが飛んでいる。目では正確な数を数えきれない。");
      } else out.push("額縁の絵。星と鳥でいっぱいの夜空。数はやっぱり数えきれない。");
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
      if (s.safeLockedUntil && Date.now() < s.safeLockedUntil) {
        out.push("金庫はロックされている。間違えすぎたみたいだ。少し待てばまた入力できる。");
        break;
      }
      if (code === s.safeCode) {
        s.safeOpen = true;
        s.hasDoorKey = true;
        s.safeFails = 0;
        out.push("カチッ、と金庫が開いた。中にドアの鍵が入っていた。ドアの鍵を手に入れた。");
      } else {
        s.safeFails = (s.safeFails ?? 0) + 1;
        if (s.safeFails >= 3) {
          s.safeLockedUntil = Date.now() + 60_000;
          s.safeFails = 0;
          out.push("ピー、とエラー音。暗証番号が違うようだ。何度も間違えたので金庫がロックされた。1分ほど待てばまた入力できる。");
        } else {
          out.push("ピー、とエラー音。暗証番号が違うようだ。");
        }
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

// 脱出後のお祝い。プレイヤーが AI に脱出キーワードを話しかけた合図で、
// AI がこの関数経由でお祝いを届ける。届けられるのは一度だけ。
export function applyCelebrate(s, word, text) {
  if (!s.escaped) return { ok: false, reason: "まだ脱出していません。" };
  if (s.celebrated) return { ok: false, reason: "お祝いはもう届いています。" };
  if (String(word ?? "").trim() !== s.clearWord)
    return { ok: false, reason: "脱出キーワードが違います。" };
  s.celebrated = true;
  const message =
    String(text ?? "").trim() || "脱出おめでとう！ 一緒に遊んでくれてありがとう。";
  return { ok: true, message };
}

// AI 向けに状態を文章化する。
export function describeStateForAI(s) {
  const lines = [];
  lines.push(s.hasKey ? "小さな鍵：入手済み" : "小さな鍵：未入手");
  lines.push(s.drawerOpen ? "引き出し：開錠済み（メモ入手済み）" : "引き出し：未開錠");
  lines.push(s.bookRead ? `赤い本：調査済み（背表紙は ${s.bookA}・${s.bookB}）` : "赤い本：未調査");
  lines.push(s.frameChecked ? `額縁の絵：調査済み（星${s.stars}つ、鳥${s.birds}羽）` : "額縁の絵：未調査");
  lines.push(s.safeOpen ? "金庫：開錠済み（ドアの鍵入手済み）" : "金庫：未開錠（暗証番号は4桁）");
  if (!s.safeOpen) {
    lines.push("金庫の暗証番号の組み立て方（画面のメモには書かれていない、相方だけの知識）：1〜2桁目＝赤い本の背表紙の数字2つ、3桁目＝額縁の絵の星の数、4桁目＝額縁の絵の鳥の数");
    if (s.safeLockedUntil && Date.now() < s.safeLockedUntil)
      lines.push(`金庫はいまロック中（入力ミスが続いたため。あと約${Math.ceil((s.safeLockedUntil - Date.now()) / 1000)}秒で解除）`);
  }
  lines.push(s.escaped ? "脱出：成功" : "脱出：まだ");
  if (s.escaped) {
    lines.push(`脱出キーワード：「${s.clearWord}」（画面に表示されている。プレイヤーがあなたにこの言葉を言ったらお祝いの合図）`);
    lines.push(s.celebrated ? "お祝い：送信済み" : "お祝い：まだ");
  }
  return lines.join("\n");
}
