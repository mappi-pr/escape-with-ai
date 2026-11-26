// 最小の MCP（Model Context Protocol）サーバーハンドラ。
// Streamable HTTP の POST JSON-RPC を、セッション操作に橋渡しする。
// アプリ版 AI（Claude / ChatGPT 等）のカスタムコネクタから、ツールとしてゲームに参加できるようにするためのもの。
//
// 常設エンドポイント（/mcp）に一度登録すれば、以後はセッションIDをツール引数で渡すだけで遊べる。
// セッション別エンドポイント（/mcp/:id）も同じツール形で受ける（resolve 側で ID の一致を縛る）。
//
// resolve(sessionId): Promise<ops|null>
// ops: {
//   brief(): Promise<string|null>,          // 状態＋ヒント集。セッションが無ければ null
//   events(since): Promise<string|null>,    // 出来事のテキスト。セッションが無ければ null
//   postMessage(text): Promise<boolean>,    // 部屋へメッセージ。失敗時 false
// }
// 戻り値: { status, payload } — payload が null の時はボディなし（通知）。

const TOOLS = [
  {
    name: "get_brief",
    description:
      "脱出ゲームの現在の状態（調査の進み具合）と、あなたが持っているヒント集と、最近の出来事をまとめて取得する。会話の節目や、合言葉で質問された時にまず使う。sessionId には参加プロンプトに書かれたセッションIDを渡す。",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "参加プロンプトに書かれたセッションID" } },
      required: ["sessionId"],
    },
  },
  {
    name: "get_events",
    description:
      "プレイヤーの行動や出来事の一覧を取得する。since に最後に見た seq を入れると差分だけ返る（0 で全部）。sessionId には参加プロンプトに書かれたセッションIDを渡す。",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "参加プロンプトに書かれたセッションID" },
        since: { type: "number", description: "最後に見たイベントの seq（省略時 0）" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "post_message",
    description:
      "ゲーム画面の部屋に、相方の AI としてメッセージを残す。挨拶や励まし、気づいたことなどを短く。sessionId には参加プロンプトに書かれたセッションIDを渡す。",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "参加プロンプトに書かれたセッションID" },
        text: { type: "string", description: "部屋に表示するメッセージ" },
      },
      required: ["sessionId", "text"],
    },
  },
];

function ok(id, result) {
  return { status: 200, payload: { jsonrpc: "2.0", id, result } };
}
function err(id, code, message) {
  return { status: 200, payload: { jsonrpc: "2.0", id, error: { code, message } } };
}
function toolText(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

export async function handleMcp(body, resolve) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      status: 400,
      payload: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
    };
  }
  const { id, method, params } = body;
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: params?.protocolVersion ?? "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "escape-with-ai", version: "0.2.0" },
    });
  }
  if (method === "ping") return ok(id, {});
  if (typeof method === "string" && method.startsWith("notifications/")) {
    return { status: 202, payload: null };
  }
  if (method === "tools/list") return ok(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
    if (!sessionId) {
      return ok(
        id,
        toolText("sessionId が必要です。参加プロンプトに書かれたセッションIDを渡してください。", true)
      );
    }
    let ops = null;
    try {
      ops = await resolve(sessionId);
    } catch {
      ops = null;
    }
    if (!ops) {
      return ok(id, toolText(`セッション ${sessionId} が見つかりませんでした。`, true));
    }
    try {
      if (name === "get_brief") {
        const text = await ops.brief();
        if (text === null) return ok(id, toolText("セッションが見つかりませんでした。", true));
        return ok(id, toolText(text));
      }
      if (name === "get_events") {
        const text = await ops.events(Number(args.since ?? 0));
        if (text === null) return ok(id, toolText("セッションが見つかりませんでした。", true));
        return ok(id, toolText(text));
      }
      if (name === "post_message") {
        const text = String(args.text ?? "").trim();
        if (!text) return ok(id, toolText("text が空です。", true));
        const done = await ops.postMessage(text);
        if (!done) return ok(id, toolText("メッセージを残せませんでした（セッションが見つからない可能性）。", true));
        return ok(id, toolText("部屋にメッセージを残しました。"));
      }
      return ok(id, toolText(`未知のツールです: ${name}`, true));
    } catch {
      return ok(id, toolText("サーバー側でエラーが起きました。", true));
    }
  }

  if (isNotification) return { status: 202, payload: null };
  return err(id ?? null, -32601, `Method not found: ${method}`);
}
