// escape-with-ai サーバー（依存なし・Node標準のみ）
// 人間は GUI（public/）から、AI は curl で /api/sessions/:id/ai/* から、同じセッションに参加する。
// 状態はインメモリ。永続化はしない（試作ベース）。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  createRoomState,
  visibleKeywords,
  spotViews,
  inventory,
  applyAction,
  describeStateForAI,
  HINTS,
} from "./room.mjs";
import { buildJoinPrompt } from "./prompt.mjs";

const PORT = process.env.PORT ?? 8787;
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const sessions = new Map();

function newSession(name) {
  const id = randomBytes(6).toString("hex"); // 12桁。セッションIDそのものが参加キー
  const s = {
    id,
    name,
    room: createRoomState(),
    events: [],
    seq: 0,
    createdAt: Date.now(),
  };
  pushEvent(s, "game", `「${name}」さんが部屋に入った。相方のAIを待っている。`);
  sessions.set(id, s);
  return s;
}

function pushEvent(s, kind, text) {
  s.seq += 1;
  s.events.push({ seq: s.seq, ts: Date.now(), kind, text });
}

function publicBase(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${host}`;
}

function guiState(s) {
  return {
    sessionId: s.id,
    name: s.name,
    spots: spotViews(s.room),
    inventory: inventory(s.room),
    keywords: visibleKeywords(s.room),
    escaped: s.room.escaped,
    lastSeq: s.seq,
  };
}

function aiBrief(s) {
  const hints = Object.entries(HINTS)
    .map(([k, v]) => `- ${k}：${v}`)
    .join("\n");
  const recent = s.events
    .slice(-10)
    .map((e) => `#${e.seq} [${e.kind}] ${e.text}`)
    .join("\n");
  return [
    `■ 現在の状態`,
    describeStateForAI(s.room),
    ``,
    `■ いま画面に出ているキーワード（合言葉「ゲームのヒント：○○」の○○）`,
    visibleKeywords(s.room).join("、") || "（なし）",
    ``,
    `■ ヒント集（聞かれたキーワードの分だけ答えること）`,
    hints,
    ``,
    `■ 最近の出来事`,
    recent,
  ].join("\n");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, code, obj) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // --- API ---
  if (path === "/api/sessions" && req.method === "POST") {
    const body = await readJson(req);
    const name = String(body.name ?? "").trim() || "プレイヤー";
    const s = newSession(name);
    const joinPrompt = buildJoinPrompt({ baseUrl: publicBase(req), sessionId: s.id, name });
    return sendJson(res, 201, { sessionId: s.id, name, joinPrompt });
  }

  const m = path.match(/^\/api\/sessions\/([a-f0-9]+)(\/.*)?$/);
  if (m) {
    const s = sessions.get(m[1]);
    if (!s) return sendJson(res, 404, { error: "session not found" });
    const sub = m[2] ?? "";

    if (sub === "/state" && req.method === "GET") return sendJson(res, 200, guiState(s));

    if (sub === "/events" && req.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0);
      return sendJson(res, 200, {
        events: s.events.filter((e) => e.seq > since),
        lastSeq: s.seq,
      });
    }

    if (sub === "/action" && req.method === "POST") {
      const body = await readJson(req);
      const texts = applyAction(s.room, body);
      for (const t of texts) pushEvent(s, "game", t);
      return sendJson(res, 200, guiState(s));
    }

    if (sub === "/ai/brief" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(aiBrief(s));
    }

    if (sub === "/ai/message" && req.method === "POST") {
      const body = await readJson(req);
      const text = String(body.text ?? "").trim();
      if (!text) return sendJson(res, 400, { error: "text is required" });
      pushEvent(s, "ai", text);
      return sendJson(res, 200, { ok: true, seq: s.seq });
    }

    return sendJson(res, 404, { error: "unknown endpoint" });
  }

  // --- 静的ファイル ---
  if (req.method === "GET") {
    const rel = path === "/" ? "index.html" : path.slice(1);
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      return res.end(data);
    } catch {
      res.writeHead(404);
      return res.end("not found");
    }
  }

  res.writeHead(405);
  res.end("method not allowed");
});

server.listen(PORT, () => {
  console.log(`escape-with-ai listening on http://localhost:${PORT}`);
});
