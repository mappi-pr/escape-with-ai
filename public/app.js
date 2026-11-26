// escape-with-ai フロントエンド
// 参加：名前を送るとセッションが発行され、AI 招待プロンプトが表示される。
// 部屋：スポットをクリックして調べ、状態とイベントはポーリング（1.5秒）で反映する。

let sessionId = null;
let lastSeq = 0;
let pollTimer = null;

const $ = (id) => document.getElementById(id);

$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("name-input").value.trim();
  if (!name) return;
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  sessionId = data.sessionId;
  $("prompt-text").value = data.joinPrompt;
  $("prompt-box").hidden = false;
});

$("copy-btn").addEventListener("click", async () => {
  const t = $("prompt-text");
  t.select();
  try {
    await navigator.clipboard.writeText(t.value);
    $("copy-btn").textContent = "コピーしました";
    setTimeout(() => ($("copy-btn").textContent = "プロンプトをコピー"), 2000);
  } catch {
    document.execCommand("copy");
  }
});

$("go-room-btn").addEventListener("click", () => {
  if (!sessionId) return;
  $("view-join").hidden = true;
  $("view-room").hidden = false;
  startPolling();
});

async function fetchState() {
  const res = await fetch(`/api/sessions/${sessionId}/state`);
  if (!res.ok) return null;
  return res.json();
}

async function fetchEvents() {
  const res = await fetch(`/api/sessions/${sessionId}/events?since=${lastSeq}`);
  if (!res.ok) return;
  const data = await res.json();
  for (const ev of data.events) appendLog(ev);
  lastSeq = data.lastSeq;
}

function appendLog(ev) {
  const li = document.createElement("li");
  if (ev.kind === "ai") li.className = "ai";
  li.textContent = ev.text;
  $("log").prepend(li);
}

function render(state) {
  $("player-line").textContent = `プレイヤー：${state.name}`;
  $("escaped-banner").hidden = !state.escaped;

  const spots = $("spots");
  spots.innerHTML = "";
  for (const sp of state.spots) {
    const b = document.createElement("button");
    b.className = "spot";
    b.innerHTML = `<span class="spot-label"></span><span class="spot-note"></span>`;
    b.querySelector(".spot-label").textContent = sp.label;
    b.querySelector(".spot-note").textContent = sp.note;
    b.addEventListener("click", () => onSpot(sp.id));
    spots.appendChild(b);
  }

  $("inventory").textContent =
    state.inventory.length > 0 ? state.inventory.join("、") : "（なし）";

  const kw = $("keywords");
  kw.innerHTML = "";
  if (state.keywords.length === 0) {
    const li = document.createElement("li");
    li.textContent = "いまは特にないみたい。";
    kw.appendChild(li);
  }
  for (const k of state.keywords) {
    const li = document.createElement("li");
    li.innerHTML = `AIに <span class="kw"></span> と聞いてみよう`;
    li.querySelector(".kw").textContent = `「ゲームのヒント：${k}」`;
    kw.appendChild(li);
  }
}

async function onSpot(spotId) {
  if (spotId === "safe") {
    // 金庫はまず入力欄を出す。番号が入っていればそれで試す。
    const form = $("safe-form");
    const code = $("safe-code").value.trim();
    if (form.hidden) {
      form.hidden = false;
      $("safe-code").focus();
      await postAction({ spot: "safe" });
      return;
    }
    if (code) {
      await postAction({ spot: "safe", code });
      $("safe-code").value = "";
      return;
    }
    await postAction({ spot: "safe" });
    return;
  }
  await postAction({ spot: spotId });
}

async function postAction(action) {
  await fetch(`/api/sessions/${sessionId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  await refresh();
}

$("safe-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("safe-code").value.trim();
  if (code) {
    await postAction({ spot: "safe", code });
    $("safe-code").value = "";
  }
});

async function refresh() {
  const state = await fetchState();
  if (state) render(state);
  await fetchEvents();
}

function startPolling() {
  refresh();
  pollTimer = setInterval(refresh, 1500);
}
