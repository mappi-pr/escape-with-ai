# escape-with-ai

**自分のAIと一緒に解く脱出ゲーム。**

人は GUI で部屋を調べ、AI は CUI（curl）から同じセッションに参加して、ヒント係と相談相手を務める。
参加は「セッション参加画面に表示されたプロンプトを、自分の AI にコピペする」だけ。

## 遊び方（設計）

1. 参加画面で名前を入力すると、セッションが発行され、AI 招待プロンプトが表示される
2. プロンプトを自分の AI に貼ると、AI がセッションに参加し、部屋に挨拶を残す。接続方法は人間が選ばず、プロンプトの指示で AI が使える方を自分で選ぶ（両方式は同じセッション状態を触るので、同時に使うこともできる）：
   - **ツール（MCP）**：`https://<公開URL>/mcp/<セッションID>` をカスタムコネクタとして追加した AI が、ツール（get_brief / get_events / post_message）で参加する
   - **curl**：シェルや HTTP を実行できる AI が、curl で API を叩く
   - どちらも無い AI は、プロンプトの指示で人間にコネクタ登録を頼む
3. 人は画面をぽちぽち調べて謎を解く
4. 詰まったら、画面に出ているキーワードを合言葉で AI に聞く：**「ゲームのヒント：○○」**
   - 合言葉の形にすることで、ふだんの会話や他の質問と競合しない
   - AI は brief（状態＋ヒント集）を取り直し、聞かれたキーワードの範囲だけ答える
5. AI は部屋にメッセージも残せる（画面に表示される）

通信は会話のターンに合わせたポーリング（GUI 1.5秒間隔）。即時性が要る場面が出てきたら SSE / WebSocket へ移行する。

## 起動（ローカル・Node 版）

```sh
npm start
# → http://localhost:8787 （PORT 環境変数で変更可）
```

外部公開時は `PUBLIC_BASE_URL` に公開 URL を設定すると、招待プロンプト内の URL がそちらになる。

## Cloudflare へ置く（本番）

Workers + Durable Objects で動かす。セッション1つ = Durable Object 1個で、状態は DO ストレージに保存される。

- `worker/worker.mjs` — Worker 本体＋ Session Durable Object（部屋ロジックは `server/room.mjs` を共用）
- `wrangler.toml` — 静的アセットは `public/`、`/api/*` は Worker 先行

デプロイ手順（GitHub 連携）:

1. Cloudflare ダッシュボード → Workers & Pages → Create → Workers → Import a repository でこのリポジトリを選ぶ
2. Deploy command は `npx wrangler deploy`（wrangler.toml がそのまま使われる）
3. デプロイ後、表示された URL（`https://escape-with-ai.<サブドメイン>.workers.dev` など）で参加画面が開く

手元確認は `npx wrangler dev --local` で全フロー動作確認済み（2026-11-26）。

## API

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/sessions` `{name}` | セッション発行。`sessionId` と `joinPrompt` を返す |
| GET | `/api/sessions/:id/state` | GUI 用の状態（スポット・持ち物・キーワード） |
| GET | `/api/sessions/:id/events?since=N` | イベント差分（ポーリング用） |
| POST | `/api/sessions/:id/action` `{spot, code?}` | 人のクリック（部屋を調べる） |
| GET | `/api/sessions/:id/ai/brief` | AI 用：状態の文章化＋ヒント集＋最近の出来事 |
| POST | `/api/sessions/:id/ai/message` `{text}` | AI が部屋にメッセージを残す |
| GET | `/api/sessions/:id/rejoin-prompt` | 接続が切れた AI の再参加プロンプト |
| POST | `/mcp/:id` | MCP（JSON-RPC）。ツール：get_brief / get_events / post_message |

セッション ID（12桁 hex）そのものが参加キー。現状はインメモリで、再起動すると消える。

## 構成

- `server/server.mjs` — HTTP サーバー＋API（依存なし、Node 標準のみ）
- `server/room.mjs` — 部屋と謎の定義・状態遷移・AI 向け文章化
- `server/prompt.mjs` — AI 招待プロンプトの生成（合言葉ルール含む）
- `public/` — 参加画面＋脱出画面（HTML/CSS/JS）

## いまの状態

試作ベース（v0.1.0）。部屋は1つ、謎は「鍵→メモ→本と絵→金庫→脱出」の一本道。
今後の候補：部屋・謎の追加、ヒントの段階化、SSE/WebSocket 化、Cloudflare へのデプロイ、セッションの永続化。
