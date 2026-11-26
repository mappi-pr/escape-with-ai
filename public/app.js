// escape-with-ai フロントエンド
// 参加：3ステップ（部屋を作る → プロンプトをコピーしてAIに貼る → ゲーム画面へ）。
// 部屋：ステージ上のスポットをタップして調べる。状態とイベントはポーリング（1.5秒）で反映。
// キーワードはタップで「ゲームのヒント：○○」をコピーできる。

let sessionId = null;
let lastSeq = 0;
let pollTimer = null;
let prevNotes = {};
let prompts = { curl: "", mcp: "" };
let currentMode = "curl";

function setMode(mode) {
  currentMode = mode;
  $("mode-curl").classList.toggle("active", mode === "curl");
  $("mode-mcp").classList.toggle("active", mode === "mcp");
  $("mcp-box").hidden = mode !== "mcp";
  if (sessionId) {
    $("prompt-text").value = mode === "curl" ? prompts.curl : prompts.mcp;
  }
}

$("mode-curl").addEventListener("click", () => setMode("curl"));
$("mode-mcp").addEventListener("click", () => setMode("mcp"));

$("mcp-url-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("mcp-url").value);
    $("mcp-url-copy").textContent = "コピーしました";
    setTimeout(() => ($("mcp-url-copy").textContent = "URLをコピー"), 2500);
  } catch {
    $("mcp-url").select();
  }
});

const $ = (id) => document.getElementById(id);

function setStep(n, mode) {
  // mode: "active" | "locked" | "done"
  const el = $(`step${n}`);
  el.classList.remove("active", "locked", "done");
  el.classList.add(mode);
}

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
  prompts = { curl: data.joinPrompt, mcp: data.mcpPrompt };
  $("mcp-url").value = data.mcpUrl;
  $("mcp-url-copy").disabled = false;
  $("prompt-text").value = currentMode === "curl" ? prompts.curl : prompts.mcp;
  $("copy-btn").disabled = false;
  $("go-room-btn").disabled = false;
  setStep(1, "done");
  setStep(2, "active");
  $("step2").scrollIntoView({ behavior: "smooth", block: "center" });
});

$("copy-btn").addEventListener("click", async () => {
  const t = $("prompt-text");
  try {
    await navigator.clipboard.writeText(t.value);
  } catch {
    t.select();
    document.execCommand("copy");
  }
  $("copy-btn").textContent = "コピーしました";
  setStep(2, "done");
  setStep(3, "active");
  setTimeout(() => ($("copy-btn").textContent = "プロンプトをコピー"), 2500);
});

$("go-room-btn").addEventListener("click", () => {
  if (!sessionId) return;
  $("view-join").hidden = true;
  $("view-room").hidden = false;
  window.scrollTo(0, 0);
  startPolling();
});

$("rejoin-btn").addEventListener("click", async () => {
  if (!sessionId) return;
  const res = await fetch(`/api/sessions/${sessionId}/rejoin-prompt`);
  if (!res.ok) return;
  const data = await res.json();
  try {
    await navigator.clipboard.writeText(data.prompt);
    $("rejoin-btn").textContent = "コピーしました";
    setTimeout(() => ($("rejoin-btn").textContent = "再参加プロンプトをコピー"), 2500);
  } catch {
    /* コピーできない環境では何もしない */
  }
});

async function fetchState() {
  const res = await fetch(`/api/sessions/${sessionId}/state`);
  if (!res.ok) return null;
  return res.json();
}

async function fetchEvents() {
  const res = await fetch(`/api/sessions/${sessionId}/events?since=${lastSeq}`);
  if (!res.ok) return null;
  const data = await res.json();
  let newest = null;
  for (const ev of data.events) {
    appendLog(ev, ev === data.events[data.events.length - 1]);
    newest = ev;
  }
  lastSeq = data.lastSeq;
  return newest;
}

function appendLog(ev, isNewest) {
  const li = document.createElement("li");
  if (ev.kind === "ai") li.className = "ai";
  if (isNewest) li.classList.add("new");
  li.textContent = ev.text;
  $("log").prepend(li);
}

function render(state) {
  $("player-line").textContent = `プレイヤー：${state.name}`;
  $("escaped-banner").hidden = !state.escaped;

  const stage = $("spots");
  stage.innerHTML = "";
  for (const sp of state.spots) {
    const b = document.createElement("button");
    b.className = "spot" + (sp.id === "door" ? " door" : "");
    b.dataset.spot = sp.id;
    const label = document.createElement("span");
    label.className = "spot-label";
    label.textContent = sp.label;
    const note = document.createElement("span");
    note.className = "spot-note";
    note.textContent = sp.note;
    b.append(label, note);
    if (sp.badge) {
      const badge = document.createElement("span");
      badge.className = "badge" + (sp.done ? " done" : "");
      badge.textContent = sp.done ? `✓ ${sp.badge}` : sp.badge;
      b.appendChild(badge);
    }
    if (prevNotes[sp.id] !== undefined && prevNotes[sp.id] !== sp.note) {
      b.classList.add("flash");
    }
    prevNotes[sp.id] = sp.note;
    b.addEventListener("click", () => onSpot(sp.id));
    stage.appendChild(b);
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
    const btn = document.createElement("button");
    btn.className = "kw-chip";
    btn.innerHTML = `AIに <span class="kw"></span> と聞いてみよう（タップでコピー）`;
    btn.querySelector(".kw").textContent = `「ゲームのヒント：${k}」`;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(`ゲームのヒント：${k}`);
        const s = document.createElement("span");
        s.className = "copied";
        s.textContent = "コピーしました";
        btn.appendChild(s);
        setTimeout(() => s.remove(), 2000);
      } catch {
        /* コピーできない環境では何もしない（文面は画面で読める） */
      }
    });
    li.appendChild(btn);
    kw.appendChild(li);
  }
}

async function onSpot(spotId) {
  if (spotId === "safe") {
    $("safe-message").textContent = "";
    $("safe-dialog").hidden = false;
    $("safe-code").value = "";
    setTimeout(() => $("safe-code").focus(), 50);
    return;
  }
  await postAction({ spot: spotId });
}

$("safe-close").addEventListener("click", () => {
  $("safe-dialog").hidden = true;
});

$("safe-dialog").addEventListener("click", (e) => {
  if (e.target === $("safe-dialog")) $("safe-dialog").hidden = true;
});

$("safe-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("safe-code").value.trim();
  if (!/^\d{4}$/.test(code)) {
    $("safe-message").textContent = "4桁の数字を入力してね。";
    return;
  }
  const { state, newest } = await postAction({ spot: "safe", code });
  if (state && state.spots.find((s) => s.id === "safe")?.done) {
    $("safe-dialog").hidden = true;
  } else {
    $("safe-message").textContent = newest ? newest.text : "番号が違うみたい。";
    $("safe-code").select();
  }
});

async function postAction(action) {
  const res = await fetch(`/api/sessions/${sessionId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  const state = res.ok ? await res.json() : null;
  const newest = await refresh(state);
  return { state, newest };
}

async function refresh(knownState) {
  const state = knownState ?? (await fetchState());
  if (state) render(state);
  return fetchEvents();
}

function startPolling() {
  refresh();
  pollTimer = setInterval(refresh, 1500);
}
