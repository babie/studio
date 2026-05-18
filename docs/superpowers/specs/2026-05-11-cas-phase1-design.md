# claude-app-server Phase 1 Design Spec

**Date:** 2026-05-11
**Scope:** `apps/claude-app-server/` の Phase 1（スケルトン疎通）
**Goal:** `claude-app-server` コマンドが起動でき、`initialize` リクエストにダミー応答を返せる状態にする。

## 背景

`apps/claude-app-server` は Codex App Server 互換の JSON-RPC 2.0 サーバを Claude Code (Anthropic Agent SDK) バックエンドで実装するアプリ。Symphony から subprocess として起動され、stdio (JSONL) で会話する。完成済みの Symphony Phase 1（`agent.type: claude` 対応）と組み合わせて Milestone 1 を達成する。

詳細仕様: [`apps/claude-app-server/CLAUDE.md`](../../../apps/claude-app-server/CLAUDE.md)、[`docs/protocol.md`](../../protocol.md)

## Phase 1 のスコープ（CLAUDE.md より）

1. `package.json`, `tsconfig.json`, `src/bin.ts` 整備
2. CLI 引数パース (`--model`, `--permission-mode`, `--allowed-tools` 等を受け取る)
3. JSON-RPC 型定義 (`src/jsonrpc/types.ts`)
4. JSONL トランスポート (`src/jsonrpc/transport.ts`)
5. Dispatcher (`src/jsonrpc/dispatcher.ts`)
6. `initialize` ハンドラ + `initialized` 通知受信
7. **動作確認**: `initialize` リクエストに応答が返る

### 非対象（後続 Phase）

- `thread/start` / `turn/start` / `turn/interrupt` 実装（Phase 2）
- Claude Agent SDK 連携（Phase 2）
- ツール呼び出しのマッピング（Phase 3）
- レート制限・ストリーミング・stub ハンドラ（Phase 4）
- README（Phase 4）

## 設計方針

### スタック

| 項目 | 採用 | 備考 |
|---|---|---|
| 言語 | TypeScript (ESM) | `"type": "module"` を `package.json` に設定 |
| ランタイム | Node.js 20+ | 開発機は Node 24.12 を確認済み |
| ビルド | `tsc` | `tsconfig.json` の `outDir: dist`、`module: NodeNext` |
| テスト | `vitest` | デフォルト設定で動かす（`vite` 単体パッケージは不要） |
| CLI 引数 | `commander` | help/usage 自動生成 |
| Lint/Format | `oxlint` + `oxfmt` | 高速、設定ゼロ近い |
| パッケージマネージャ | `pnpm` | ルートの `pnpm-workspace.yaml` に既登録 |
| TDD | 厳密 | Symphony Phase 1 と同じ |

### `claude-app-server` コマンドとして実行可能にする

`package.json` に：

```json
{
  "bin": {
    "claude-app-server": "./dist/bin.js"
  }
}
```

`src/bin.ts` 先頭に shebang `#!/usr/bin/env node` を入れ、tsc で `dist/bin.js` に保存後 `chmod +x` する（`postbuild` script で対応）。

開発時は `pnpm install` 後に `pnpm link --global` で `claude-app-server` がローカル PATH に通る。後続のモノレポ統合タスク（`scripts/install_dev.sh`）で同じ仕組みを利用予定。

### ディレクトリ構成（Phase 1 で作成する分のみ）

```
apps/claude-app-server/
├── package.json
├── tsconfig.json
├── vitest.config.ts          # 必要に応じて最小設定
├── src/
│   ├── bin.ts                # shebang 付き CLI エントリ、commander で arg parse、server.ts を呼ぶ
│   ├── server.ts             # サーバ本体（main 関数）
│   ├── jsonrpc/
│   │   ├── types.ts          # Request/Response/Notification/Error 型
│   │   ├── transport.ts      # stdio JSONL 読み書き
│   │   └── dispatcher.ts     # method → handler ルーティング、エラー処理
│   └── handlers/
│       ├── initialize.ts     # initialize ハンドラ
│       └── index.ts          # ハンドラ登録の集約
└── test/
    ├── jsonrpc/
    │   ├── transport.test.ts
    │   └── dispatcher.test.ts
    └── handlers/
        └── initialize.test.ts
```

CLAUDE.md にあった `claude/` `state/` `util/` ディレクトリは Phase 2 以降で作成する。

### コンポーネント設計

#### `src/jsonrpc/types.ts`

JSON-RPC 2.0 のメッセージ型を定義。Codex App Server 慣習に従い `jsonrpc` フィールドは optional。

```typescript
export type Id = number | string;

export interface Request<P = unknown> {
  id: Id;
  method: string;
  params?: P;
  jsonrpc?: "2.0";
}

export interface Notification<P = unknown> {
  method: string;
  params?: P;
  jsonrpc?: "2.0";
}

export interface SuccessResponse<R = unknown> {
  id: Id;
  result: R;
  jsonrpc?: "2.0";
}

export interface ErrorResponse {
  id: Id | null;
  error: { code: number; message: string; data?: unknown };
  jsonrpc?: "2.0";
}

export type Response<R = unknown> = SuccessResponse<R> | ErrorResponse;

export type IncomingMessage = Request | Notification;
export type OutgoingMessage = Response | Notification;

export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;
```

判別関数 `isRequest(msg): msg is Request` / `isNotification(msg): msg is Notification` を併設。

#### `src/jsonrpc/transport.ts`

stdio JSONL の読み書き。

責務：
- `readMessages(stream: NodeJS.ReadableStream): AsyncIterable<unknown>` — 1 行ずつ読んで `JSON.parse`、`JSON.parse` 失敗時は parse error として `{ kind: "parse_error", line }` を yield（受信側で error response を返せるように）
- `writeMessage(stream: NodeJS.WritableStream, msg: unknown): void` — `JSON.stringify(msg) + "\n"` で書く

LF 区切り。CRLF を含むデータは内部 `\n` エスケープされている前提（JSON 仕様）。

#### `src/jsonrpc/dispatcher.ts`

method → handler のルーティングとエラー処理。

```typescript
export type Handler<P = unknown, R = unknown> = (
  params: P,
  ctx: HandlerContext,
) => Promise<R> | R;

export interface HandlerContext {
  // Phase 1 では空。Phase 2 で sendNotification, threads など追加
  sendNotification(method: string, params: unknown): void;
}

export class Dispatcher {
  registerRequest(method: string, handler: Handler): void;
  registerNotification(method: string, handler: (params: unknown, ctx: HandlerContext) => void | Promise<void>): void;
  async dispatch(message: IncomingMessage, ctx: HandlerContext): Promise<OutgoingMessage | null>;
}
```

`dispatch` の挙動：
- `Request` で未登録 method → `{ id, error: { code: -32601, message: "Method not found: <method>" } }`
- `Request` でハンドラ throw → `{ id, error: { code: -32603, message: <thrown.message> } }`
- `Notification` でハンドラ throw → stderr にログ、応答なし（`null` を返す）
- `Notification` で未登録 → 黙って捨てる（`null`）

parse error は transport 側で検出して `{ id: null, error: { code: -32700, ... } }` を返す（dispatcher の前段）。

#### `src/handlers/initialize.ts`

`initialize` ハンドラ。CLAUDE.md の動作確認 (`{"id":0,"result":{"userAgent":"...","platformFamily":"...","platformOs":"..."}}`) に従い、最低限の応答を返す。Phase 1 の段階では中身は空でよいとプロトコル仕様に書いてあるが、観察可能性のため `userAgent` / `platformFamily` / `platformOs` を埋める：

```typescript
export const initializeHandler: Handler<unknown, unknown> = () => ({
  userAgent: `claude-app-server/${packageVersion}`,
  platformFamily: process.platform,
  platformOs: `${os.type()} ${os.release()}`,
});
```

`initialized` 通知ハンドラは「受信したことをログに残すだけ」。Phase 2 以降でこれを境に request 受付を有効化する状態管理を入れる予定だが、Phase 1 では未実装でも動作確認に支障なし。

#### `src/server.ts`

サーバ本体。CLI 引数を受け取って Dispatcher を組み立て、stdin/stdout でループ：

```typescript
export interface ServerOptions {
  model?: string;
  permissionMode?: string;
  allowedTools?: string[];
}

export async function runServer(opts: ServerOptions): Promise<void> {
  // 1. ANTHROPIC_API_KEY をクリア（CLAUDE.md の指示）
  delete process.env.ANTHROPIC_API_KEY;

  // 2. Dispatcher 組み立て
  const dispatcher = new Dispatcher();
  dispatcher.registerRequest("initialize", initializeHandler);
  dispatcher.registerNotification("initialized", initializedHandler);

  // 3. ctx を作成（Phase 1 では sendNotification は stdout への writeMessage を呼ぶだけ）
  const ctx: HandlerContext = {
    sendNotification: (method, params) =>
      writeMessage(process.stdout, { method, params }),
  };

  // 4. stdin から messages を読んで dispatch、結果を stdout に書く
  for await (const message of readMessages(process.stdin)) {
    const response = await dispatcher.dispatch(message, ctx);
    if (response !== null) writeMessage(process.stdout, response);
  }
}
```

#### `src/bin.ts`

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { runServer } from "./server.js";

const program = new Command()
  .name("claude-app-server")
  .description("Codex App Server compatible JSON-RPC server backed by Claude")
  .option("--model <name>", "Claude model to use")
  .option("--permission-mode <mode>", "default | acceptEdits | bypassPermissions")
  .option("--allowed-tools <list>", "comma-separated tool allowlist")
  .parse();

const opts = program.opts();
runServer({
  model: opts.model,
  permissionMode: opts.permissionMode,
  allowedTools: opts.allowedTools?.split(","),
}).catch((err) => {
  process.stderr.write(`fatal: ${err.message}\n`);
  process.exit(1);
});
```

Phase 1 では `model` / `permissionMode` / `allowedTools` は **受け取るだけ** で `runServer` には渡すが使われない（Phase 2 で SDK に渡す）。

### エラーハンドリング

| 状況 | 応答 |
|---|---|
| 不正な JSON | `{id: null, error: {code: -32700, message: "Parse error"}}` |
| `method` フィールドなし | `{id: id ?? null, error: {code: -32600, message: "Invalid Request"}}` |
| 未登録の request method | `{id, error: {code: -32601, message: "Method not found: <method>"}}` |
| ハンドラが throw | `{id, error: {code: -32603, message: <err.message>}}` |
| 未登録の notification | 無視 |
| ハンドラが throw（notification） | stderr にログ、応答なし |

### stdout 汚染防止

- `console.log` 禁止。テスト・開発時にも誤って入らないように `oxlint` 設定で `no-console` を warn 以上にする
- ログは `process.stderr.write` または `console.error`
- Phase 2 以降で `src/util/logger.ts` を導入予定

## TDD でのテスト戦略

各タスクで「失敗テスト→実装→PASS→commit」を 1 サイクルとする。

### テストファイル

| テスト | 検証内容 |
|---|---|
| `test/jsonrpc/transport.test.ts` | 読み: 複数行の JSONL を順に yield する／不正 JSON で parse_error を yield する。書き: `\n` 区切りで write する |
| `test/jsonrpc/dispatcher.test.ts` | request/notification の登録と dispatch、未登録 method で MethodNotFound、ハンドラ throw で InternalError、notification の throw でも response が null |
| `test/handlers/initialize.test.ts` | `initialize` 応答が `userAgent` / `platformFamily` / `platformOs` を返す |

E2E 的なスモークテスト（`bin.ts` 起動 → `initialize` 投入 → 応答受信）は手動確認のみ（CLAUDE.md §動作確認手順 と同じ）。`vitest` で spawn する E2E は Phase 2 以降で検討。

## 動作確認手順

```bash
cd apps/claude-app-server
pnpm install
pnpm build
chmod +x dist/bin.js   # postbuild で自動化、念のため

echo '{"id":0,"method":"initialize","params":{"clientInfo":{"name":"test","title":"Test","version":"0.1.0"}}}' \
  | node dist/bin.js

# 期待: {"id":0,"result":{"userAgent":"claude-app-server/0.1.0","platformFamily":"darwin","platformOs":"Darwin 25.3.0"}}
```

`pnpm link --global` で `claude-app-server` コマンドとしても実行できることを確認。

## 完了条件

- [ ] `pnpm install && pnpm build && pnpm test` がエラーなく通る
- [ ] `claude-app-server` コマンドで起動でき、`initialize` 応答が返る（手動確認）
- [ ] `dist/bin.js` に shebang と実行ビットがある
- [ ] `package.json` の `bin` で `claude-app-server` がマップされている
- [ ] vitest で 3 つのテストファイルが全部 PASS
- [ ] oxlint で警告なし

## 不確実性 / 後で確認したい事項

1. **`oxfmt` の安定性**: 比較的新しい。動かなかったら Prettier に切り替え
2. **`pnpm link --global` の挙動**: モノレポ workspace 内で動くかどうか実機で確認
3. **`vitest` のデフォルト ESM 対応**: `tsconfig.json` の `module: NodeNext` と vitest の transform が衝突しないか実機確認
4. **commander のオプション名規則**: `--allowed-tools` を `opts.allowedTools` で受けられるか（コーディング時に確認）

これらは実装中に発見次第、ユーザに確認する。
