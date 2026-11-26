// escape-with-ai — Cloudflare Workers 版
// 静的ファイル（public/）は Workers Static Assets、API はこの Worker が処理する。
// セッションは1つ = Durable Object 1個。状態は DO ストレージに保存する（再起動・再配置でも消えない）。
// 部屋ロジック（room.mjs）と招待プロンプト（prompt.mjs）は Node 版と共通。

import {
  createRoomState,
  visibleKeywords,
  spotViews,
  inventory,
  applyAction,
  describeStateForAI,
  HINTS,
} from "../server/room.mjs";
import { buildJoinPrompt, buildRejoinPrompt } from "../server/prompt.mjs";
import { handleMcp } from "../server/mcp.mjs";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function newSessionId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class Session {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = null; // { name, room, events, seq, createdAt }
  }

  async load() {
    if (!this.state) {
      this.state = (await this.ctx.storage.get("state")) ?? null;
    }
    return this.state;
  }

  async save() {
    await this.ctx.storage.put("state", this.state);
  }

  pushEvent(kind, text) {
    this.state.seq += 1;
    this.state.events.push({ seq: this.state.seq, ts: Date.now(), kind, text });
  }

  guiState() {
    const s = this.state;
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

  aiBrief() {
    const s = this.state;
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

  async fetch(req) {
    const url = new URL(req.url);
    const sub = url.pathname; // DO 内部パス: /init /state /events /action /ai/brief /ai/message

    if (sub === "/init" && req.method === "POST") {
      if (await this.load()) return json({ error: "already initialized" }, 409);
      const body = await req.json().catch(() => ({}));
      const name = String(body.name ?? "").trim() || "プレイヤー";
      this.state = {
        id: String(body.id ?? ""),
        name,
        room: createRoomState(),
        events: [],
        seq: 0,
        createdAt: Date.now(),
      };
      this.pushEvent("game", `「${name}」さんが部屋に入った。相方のAIを待っている。`);
      await this.save();
      return json({ ok: true });
    }

    const s = await this.load();
    if (!s) return json({ error: "session not found" }, 404);

    if (sub === "/state" && req.method === "GET") return json(this.guiState());

    if (sub === "/events" && req.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0);
      return json({ events: s.events.filter((e) => e.seq > since), lastSeq: s.seq });
    }

    if (sub === "/action" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const texts = applyAction(s.room, body);
      for (const t of texts) this.pushEvent("game", t);
      await this.save();
      return json(this.guiState());
    }

    if (sub === "/ai/brief" && req.method === "GET") {
      return new Response(this.aiBrief(), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (sub === "/ai/message" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const text = String(body.text ?? "").trim();
      if (!text) return json({ error: "text is required" }, 400);
      this.pushEvent("ai", text);
      await this.save();
      return json({ ok: true, seq: s.seq });
    }

    return json({ error: "unknown endpoint" }, 404);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/sessions" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name ?? "").trim() || "プレイヤー";
      const id = newSessionId();
      const stub = env.SESSION.getByName(id);
      const initRes = await stub.fetch("https://session/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      if (!initRes.ok) return json({ error: "failed to create session" }, 500);
      const mcpRoot = `${url.origin}/mcp`;
      const joinPrompt = buildJoinPrompt({ baseUrl: url.origin, sessionId: id, name, mcpRoot });
      return json({ sessionId: id, name, joinPrompt, mcpUrl: mcpRoot }, 201);
    }

    const m = path.match(/^\/api\/sessions\/([a-f0-9]+)(\/.*)?$/);
    if (m) {
      // 再参加プロンプトは Worker 側で生成する（公開オリジンが必要なため）。
      // セッションの存在確認と名前の取得だけ DO に聞く。
      if ((m[2] ?? "") === "/rejoin-prompt" && req.method === "GET") {
        const stub = env.SESSION.getByName(m[1]);
        const stateRes = await stub.fetch("https://session/state");
        if (!stateRes.ok) return json({ error: "session not found" }, 404);
        const st = await stateRes.json();
        const prompt = buildRejoinPrompt({
          baseUrl: url.origin,
          sessionId: m[1],
          name: st.name,
          mcpRoot: `${url.origin}/mcp`,
        });
        return json({ prompt });
      }
      const stub = env.SESSION.getByName(m[1]);
      const sub = m[2] ?? "/";
      const forward = new Request(`https://session${sub}${url.search}`, req);
      return stub.fetch(forward);
    }

    // MCP（アプリ版 AI のカスタムコネクタ用）。操作は DO の既存エンドポイント経由。
    const opsForStub = (stub) => ({
      brief: async () => {
        const r = await stub.fetch("https://session/ai/brief");
        return r.ok ? r.text() : null;
      },
      events: async (since) => {
        const r = await stub.fetch(`https://session/events?since=${since}`);
        if (!r.ok) return null;
        const d = await r.json();
        return (
          d.events.map((e) => `#${e.seq} [${e.kind}] ${e.text}`).join("\n") ||
          "（新しい出来事はない）"
        );
      },
      postMessage: async (text) => {
        const r = await stub.fetch("https://session/ai/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        return r.ok;
      },
    });
    const runMcp = async (resolve) => {
      const body = await req.json().catch(() => null);
      const { status, payload } = await handleMcp(body, resolve);
      if (payload === null) return new Response(null, { status });
      return json(payload, status);
    };

    // 常設エンドポイント（登録は一度だけ。セッションはツール引数で選ぶ）
    if (path === "/mcp" && req.method === "POST") {
      return runMcp(async (sid) => {
        if (!/^[a-f0-9]+$/.test(sid)) return null;
        return opsForStub(env.SESSION.getByName(sid));
      });
    }

    // セッション別エンドポイント（ID が一致するセッションだけ触れる）
    const mcpMatch = path.match(/^\/mcp\/([a-f0-9]+)$/);
    if (mcpMatch && req.method === "POST") {
      const stub = env.SESSION.getByName(mcpMatch[1]);
      return runMcp(async (sid) => (sid === mcpMatch[1] ? opsForStub(stub) : null));
    }

    if (path.startsWith("/api/")) return json({ error: "not found" }, 404);

    // それ以外は静的アセット（public/）
    return env.ASSETS.fetch(req);
  },
};
