# claude-app-server kamae レビュー修正タスク

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/claude-app-server` の kamae レビュー (`/kamae-review`) で挙がった 1 High + 6 Low の指摘を全て修正する。

**前提状態 (2026-05-11):**

- `main` ブランチに claude-app-server Phase 1 完了済み（merge `a527420` + deps bump `6562a6a` + kamae リファクタ `58c2ecc`）
- 全テスト 21/21 PASS、`pnpm lint` clean、`pnpm format:check` clean、`pnpm build` 成功
- スモークテスト: `echo '{"id":0,"method":"initialize","params":{}}' | node apps/claude-app-server/dist/bin.js` → `{"id":0,"result":{"userAgent":"claude-app-server/0.1.0","platformFamily":"darwin","platformOs":"Darwin 25.3.0"}}` 動作確認済み

**Tech Stack:** TypeScript ESM (NodeNext) + tsc 6 + vitest 4 + commander 14 + valibot 1 + @praha/byethrow 0.11 + @standard-schema/spec + oxlint 1.63 + oxfmt 0.48

**作業ブランチ:** `fix/cas-kamae-review` を `main` から切る

**実行コマンド:**

```bash
cd /Users/babie/src/github.com/babie/concert/apps/claude-app-server
pnpm test          # vitest run
pnpm lint          # oxlint
pnpm format:check  # oxfmt --check
pnpm build         # tsc + chmod
pnpm exec tsc --noEmit  # 型チェックのみ
```

**スモークテスト:**

```bash
cd /Users/babie/src/github.com/babie/concert
echo '{"id":0,"method":"initialize","params":{}}' | node apps/claude-app-server/dist/bin.js
echo '{"id":1,"method":"thread/start","params":{}}' | node apps/claude-app-server/dist/bin.js  # MethodNotFound 確認
```

**参考:**

- レビュー出処の原則ファイル群: `~/.claude/skills/kamae/{domain-modeling,boundary-defense,error-handling,test-data}.md`
- valibot ガイド: `~/.claude/skills/kamae/validation-libraries/valibot.md`
- byethrow ガイド: `~/.claude/skills/kamae/result-libraries/byethrow.md`
- 元の Phase 1 spec: `docs/superpowers/specs/2026-05-11-cas-phase1-design.md`

---

## Task 1: ブランチ切り

- [ ] **Step 1:**
  ```bash
  cd /Users/babie/src/github.com/babie/concert
  git checkout main
  git status   # working tree clean を確認
  git checkout -b fix/cas-kamae-review
  ```

---

## Task 2 [High]: CLI 引数を valibot で境界バリデーション

**問題:** `src/bin.ts:22-26` で `program.opts() as { ... }` と型アサーション。CLI 入力（外部入力）がランタイム検証なし。`permission-mode` の値が `default | acceptEdits | bypassPermissions` のいずれかであることも未検証。

**Files:**
- Modify: `apps/claude-app-server/src/bin.ts`
- Modify: `apps/claude-app-server/src/server.ts`

### Step 1: ServerOptions 型と schema を定義（server.ts に集約）

`apps/claude-app-server/src/server.ts` の冒頭に valibot スキーマと parse 関数を追加し、既存の `ServerOptions` 型を schema 由来に置き換える。

```typescript
import type { Result } from "@praha/byethrow";
import * as v from "valibot";
import { Dispatcher, type HandlerContext } from "./jsonrpc/dispatcher.js";
import { OutgoingNotification } from "./jsonrpc/outgoing-message.js";
import { schemaResult, type ValidationError } from "./jsonrpc/schema-result.js";
import { readMessages, writeMessage } from "./jsonrpc/transport.js";
import { registerHandlers } from "./handlers/index.js";

const ServerOptionsSchema = v.object({
  model: v.optional(v.string()),
  permissionMode: v.optional(
    v.picklist(["default", "acceptEdits", "bypassPermissions"]),
  ),
  allowedTools: v.optional(v.array(v.string())),
});

export type ServerOptions = v.InferOutput<typeof ServerOptionsSchema>;

export const ServerOptions: Readonly<{
  schema: typeof ServerOptionsSchema;
  parse: (raw: unknown) => Result.Result<ServerOptions, ValidationError>;
}> = {
  schema: ServerOptionsSchema,
  parse: schemaResult(ServerOptionsSchema),
} as const;

export const runServer = async (_opts: ServerOptions): Promise<void> => {
  // CLAUDE.md: Pro/Max OAuth 認証を使うため API キー経路を遮断する
  delete process.env.ANTHROPIC_API_KEY;

  const dispatcher = Dispatcher.create();
  registerHandlers(dispatcher);

  const ctx: HandlerContext = {
    sendNotification: (method, params) =>
      writeMessage(process.stdout, OutgoingNotification.of(method, params)),
  };

  for await (const message of readMessages(process.stdin)) {
    const response = await dispatcher.dispatch(message, ctx);
    if (response !== null) writeMessage(process.stdout, response);
  }
};
```

### Step 2: bin.ts を書き換え

```typescript
#!/usr/bin/env node
import { Result } from "@praha/byethrow";
import { Command } from "commander";
import { ServerOptions, runServer } from "./server.js";

const program = new Command()
  .name("claude-app-server")
  .description(
    "Codex App Server compatible JSON-RPC server backed by Claude (stdio JSONL)",
  )
  .option("--model <name>", "Claude model name (e.g. claude-opus-4-7)")
  .option(
    "--permission-mode <mode>",
    "default | acceptEdits | bypassPermissions",
  )
  .option(
    "--allowed-tools <list>",
    "comma-separated tool allowlist",
    (v) => v.split(",").map((s) => s.trim()).filter(Boolean),
  )
  .parse();

const parsed = ServerOptions.parse(program.opts());
if (Result.isFailure(parsed)) {
  process.stderr.write(
    `invalid options: ${JSON.stringify(parsed.error.issues)}\n`,
  );
  process.exit(2);
}

runServer(parsed.value).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`fatal: ${message}\n`);
  process.exit(1);
});
```

注意点:
- `[] as string[]` の default 引数を削除（Task 7 と統合）。commander は default なしでも optional として扱える。
- `as` キャスト全廃。
- `process.exit(2)` で invalid options を区別（既存の fatal は `1`）。

### Step 3: 検証

```bash
cd apps/claude-app-server
pnpm exec tsc --noEmit
pnpm test
pnpm build
echo '{"id":0,"method":"initialize","params":{}}' | node dist/bin.js
# 期待: 既存 smoke と同じ応答

# 追加: 不正な permission-mode を拒否することを確認
node dist/bin.js --permission-mode bogus < /dev/null
# 期待: stderr に "invalid options: ..." が出て exit code 2
```

### Step 4: コミット

```bash
git add apps/claude-app-server/src/bin.ts apps/claude-app-server/src/server.ts
git commit -m "fix(claude-app-server): validate CLI options with valibot at boundary"
```

---

## Task 3 [Low]: `Id` を Branded Type にする

**問題:** `src/jsonrpc/id.ts` の `Id = number | string` がブランドなし。Phase 2 で `ThreadId`/`TurnId` 等が増えると取り違えやすい。

**Files:**
- Modify: `apps/claude-app-server/src/jsonrpc/id.ts`

### Step 1: schema にブランドを追加

```typescript
import type { Result } from "@praha/byethrow";
import * as v from "valibot";
import { schemaResult, type ValidationError } from "./schema-result.js";

const IdSchema = v.pipe(v.union([v.number(), v.string()]), v.brand("JsonRpcId"));

export type Id = v.InferOutput<typeof IdSchema>;

export const Id: Readonly<{
  schema: typeof IdSchema;
  parse: (raw: unknown) => Result.Result<Id, ValidationError>;
}> = {
  schema: IdSchema,
  parse: schemaResult(IdSchema),
} as const;
```

### Step 2: 影響箇所を確認

`Id` 型を直接構築している箇所が壊れる。具体的には：

- `incoming-message.ts` の `RequestSchema` の transform 内 `id: wire.id` — `wire.id` は `number | string` だが、Request の id は `Id` (branded)。この場合、incoming-message でも `IdSchema` を使うのが正しい:

  ```typescript
  v.object({
    id: IdSchema,    // ← ここで brand 適用
    method: v.string(),
    ...
  })
  ```

  ただし `IdSchema` の循環 import に注意（id.ts → schema-result.ts → ... の依存方向だけ守る）。

- `outgoing-message.ts` の `SuccessResponse` / `ErrorResponse` の `id: Id` 型は変えなくてよい（型は引き続き branded）。
- `dispatcher.ts` の `req.id` を `ErrorResponse.of(req.id, ...)` に渡す箇所も問題なし（`Id` は維持）。
- テストフィクスチャ `{ id: 1, ... }` は `Id` (branded) を期待。`as const satisfies IncomingMessage` を併用するか、テストヘルパーで brand 適用が必要 — Task 8 と一緒に整える。

### Step 3: 検証

```bash
pnpm exec tsc --noEmit
pnpm test
```

テストで `id: 1` リテラルを使っている箇所が brand なしで型エラーになる可能性。エラーメッセージを見て、Task 8 の修正を先に取り入れるか、テスト側で `Id.parse(1)` を使うか判断。

### Step 4: コミット

```bash
git add apps/claude-app-server/src/jsonrpc/id.ts apps/claude-app-server/src/jsonrpc/incoming-message.ts
# テストも触ったらそれも追加
git commit -m "fix(claude-app-server): brand Id with valibot v.brand"
```

---

## Task 4 [Low]: `Request` / `Notification` を `Readonly<>` に

**問題:** `incoming-message.ts:23, 40` で `v.InferOutput` から推論した型が `Readonly<>` になっていない。他のドメイン型は揃って `Readonly<{...}>` 使用。

**Files:**
- Modify: `apps/claude-app-server/src/jsonrpc/incoming-message.ts`

### Step 1: 型を先に明示してから schema で強制する

```typescript
import type { Result } from "@praha/byethrow";
import * as v from "valibot";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Id } from "./id.js";
import { schemaResult, type ValidationError } from "./schema-result.js";

// --- Request ---

export type Request = Readonly<{
  kind: "Request";
  id: Id;
  method: string;
  params: unknown;
}>;

const RequestSchema = v.pipe(
  v.object({
    id: Id.schema,
    method: v.string(),
    params: v.optional(v.unknown()),
    jsonrpc: v.optional(v.literal("2.0")),
  }),
  v.transform(
    (wire): Request => ({
      kind: "Request",
      id: wire.id,
      method: wire.method,
      params: wire.params,
    }),
  ),
);

// --- Notification ---

export type Notification = Readonly<{
  kind: "Notification";
  method: string;
  params: unknown;
}>;

const NotificationSchema = v.pipe(
  v.object({
    method: v.string(),
    params: v.optional(v.unknown()),
    jsonrpc: v.optional(v.literal("2.0")),
  }),
  v.transform(
    (wire): Notification => ({
      kind: "Notification",
      method: wire.method,
      params: wire.params,
    }),
  ),
);

// --- ParseError ... (既存のまま) ---
// --- InvalidMessage ... (既存のまま) ---
// --- IncomingMessage union ... (既存のまま) ---
```

注: Task 3 の `Id.schema` を `id` フィールドに使うことで、Brand Type が自動適用される。Task 3 と Task 4 はセットでやるほうが整合がとりやすい。

### Step 2: 検証 + コミット

```bash
pnpm exec tsc --noEmit
pnpm test
git add apps/claude-app-server/src/jsonrpc/incoming-message.ts
git commit -m "fix(claude-app-server): make Request/Notification types Readonly"
```

---

## Task 5 [Low]: `ErrorPayload` をドメインエラー DU に分離

**問題:** `outgoing-message.ts:22-26` の `ErrorPayload` は wire 形式そのままで、`code` の数値で識別。ドメイン側で discriminated union として扱えない。

**Files:**
- Create: `apps/claude-app-server/src/jsonrpc/dispatch-error.ts`
- Modify: `apps/claude-app-server/src/jsonrpc/dispatcher.ts`
- Modify: `apps/claude-app-server/src/jsonrpc/outgoing-message.ts`

### Step 1: `dispatch-error.ts` を新設

```typescript
import { ErrorCode } from "./error-code.js";
import type { ErrorPayload } from "./outgoing-message.js";

export type DispatchError =
  | Readonly<{ kind: "ParseError" }>
  | Readonly<{ kind: "InvalidRequest" }>
  | Readonly<{ kind: "MethodNotFound"; method: string }>
  | Readonly<{ kind: "InternalError"; cause: unknown }>;

export const DispatchError = {
  toErrorPayload: (err: DispatchError): ErrorPayload => {
    switch (err.kind) {
      case "ParseError":
        return { code: ErrorCode.ParseError, message: "Parse error" };
      case "InvalidRequest":
        return { code: ErrorCode.InvalidRequest, message: "Invalid Request" };
      case "MethodNotFound":
        return {
          code: ErrorCode.MethodNotFound,
          message: `Method not found: ${err.method}`,
        };
      case "InternalError":
        return {
          code: ErrorCode.InternalError,
          message:
            err.cause instanceof Error ? err.cause.message : String(err.cause),
        };
    }
  },
} as const;
```

注: switch に `default: return assertNever(err)` を入れたいところだが、上記の case を網羅すれば exhaustive。lint/tsc が exhaustiveness を保証する。明示的に `assertNever` を入れる場合は import して `default:` を追加。

### Step 2: dispatcher.ts を書き換え

`ErrorResponse.of` を直接呼ぶ箇所を `DispatchError` 経由にする:

```typescript
import { DispatchError } from "./dispatch-error.js";
// 既存の ErrorCode import を削除（dispatch-error 経由に集約）

// dispatchRequest 内
if (!handler) {
  return ErrorResponse.of(
    req.id,
    DispatchError.toErrorPayload({ kind: "MethodNotFound", method: req.method }),
  );
}
// ...
} catch (err) {
  return ErrorResponse.of(
    req.id,
    DispatchError.toErrorPayload({ kind: "InternalError", cause: err }),
  );
}

// dispatch switch 内
case "ParseError":
  return ErrorResponse.of(null, DispatchError.toErrorPayload({ kind: "ParseError" }));
case "InvalidMessage":
  return ErrorResponse.of(null, DispatchError.toErrorPayload({ kind: "InvalidRequest" }));
```

dispatchNotification の stderr ログは domain error ではなく単なるロギングなので変更不要。

### Step 3: 検証 + コミット

```bash
pnpm exec tsc --noEmit
pnpm test
git add apps/claude-app-server/src/jsonrpc/dispatch-error.ts apps/claude-app-server/src/jsonrpc/dispatcher.ts
git commit -m "fix(claude-app-server): introduce DispatchError DU for typed dispatch errors"
```

---

## Task 6 [Low]: `incoming-message.ts` / `outgoing-message.ts` の判断記録

**問題:** 1 ファイルに複数の型 (Request, Notification, ParseError, InvalidMessage 等) が同居。

**Files:**
- Modify: 既存ファイル末尾にコメント追加

### Step 1: 判断を残すコメントを追加

`incoming-message.ts` 冒頭にコメント:

```typescript
// File grouping rationale: kamae の "one concept per file" を厳密に取れば
// Request / Notification / ParseError / InvalidMessage は別ファイルに分けるべきだが、
// これら 4 つは IncomingMessage discriminated union のメンバーとして常に一緒に
// 利用される設計上一体の概念。各バリアントに companion 固有のロジックが増えた
// 段階で再評価する。
```

`outgoing-message.ts` 冒頭にも同様のコメント。

注: kamae 的にはコメント最小化が原則だが、レビューで挙がった項目への deliberate な決定は記録に値する（[`using-superpowers/SKILL.md` の "If you deviate from a principle, state the reason in a comment"](https://docs.anthropic.com/...) に該当）。

### Step 2: コミット

```bash
git add apps/claude-app-server/src/jsonrpc/incoming-message.ts apps/claude-app-server/src/jsonrpc/outgoing-message.ts
git commit -m "docs(claude-app-server): record file-grouping decision for message unions"
```

**もし判断を変えて分割する場合**: ファイル分割を実施する。新ファイルは `request.ts`, `notification.ts`, `parse-error.ts`, `invalid-message.ts`, `incoming-message.ts` (union と parser のみ) など。import 経路を整理。Task 5 の DispatchError も同じ流儀。これは大きめのリファクタなので別タスクに回すか、Step 1 の判断コメントだけ入れて完了にしてよい。

---

## Task 7 [Low]: 軽微な `as` キャストを除去

**問題:** 以下の `as` を取り除く。

| 場所 | 現状 | 修正 |
|---|---|---|
| `src/bin.ts:18` | `[] as string[]` (default 引数) | Task 2 で削除済みのはず — 二重チェック |
| `src/jsonrpc/transport.ts:23` | `chunk as string` | typeof guard で置換 |
| `test/handlers/initialize.test.ts:11-13` | `expect.stringMatching(...) as unknown` | `expect.objectContaining` で書き換え |

**Files:**
- Modify: `apps/claude-app-server/src/jsonrpc/transport.ts`
- Modify: `apps/claude-app-server/test/handlers/initialize.test.ts`

### Step 1: transport.ts の chunk 型

`stream.setEncoding("utf8")` 後、Node の型は依然 `string | Buffer`。runtime guard を入れる:

```typescript
for await (const chunk of stream) {
  if (typeof chunk !== "string") {
    // setEncoding が効いている前提では到達しないが、保険として
    process.stderr.write(`unexpected non-string chunk from stdin\n`);
    continue;
  }
  buffer += chunk;
  // ... (以下は既存の処理)
}
```

別解: `Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk`。挙動は等価。

### Step 2: test/handlers/initialize.test.ts

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  initializeHandler,
  initializedHandler,
} from "../../src/handlers/initialize.js";
import type { HandlerContext } from "../../src/jsonrpc/dispatcher.js";

const makeCtx = (): HandlerContext => ({ sendNotification: vi.fn() });

describe("initializeHandler", () => {
  it("returns userAgent / platformFamily / platformOs", async () => {
    const result = await initializeHandler({}, makeCtx());
    expect(result).toEqual(
      expect.objectContaining({
        userAgent: expect.stringMatching(/^claude-app-server\//),
        platformFamily: expect.any(String),
        platformOs: expect.any(String),
      }),
    );
  });

  it("ignores unknown params (does not throw)", async () => {
    await expect(
      initializeHandler(
        {
          capabilities: { experimentalApi: true },
          clientInfo: { name: "test", title: "Test", version: "0.1.0" },
        },
        makeCtx(),
      ),
    ).resolves.toBeDefined();
  });
});

describe("initializedHandler", () => {
  it("does not throw and returns void", async () => {
    await expect(initializedHandler({}, makeCtx())).resolves.toBeUndefined();
  });
});
```

`expect.objectContaining` の戻り値は `unknown` ではなく asymmetric matcher 型で、`.toEqual` は asymmetric matcher を受け付けるので `as unknown` は不要。

### Step 3: 検証 + コミット

```bash
pnpm exec tsc --noEmit
pnpm test
git add apps/claude-app-server/src/jsonrpc/transport.ts apps/claude-app-server/test/handlers/initialize.test.ts
git commit -m "fix(claude-app-server): remove minor as casts (chunk type, test matchers)"
```

---

## Task 8 [Low]: テストフィクスチャに `as const satisfies`

**問題:** `test/jsonrpc/dispatcher.test.ts` の `dispatch` 引数リテラルが `as const satisfies IncomingMessage` を使っていない。Task 3 の Brand Type 導入後にテストが壊れる可能性が高いので、ヘルパーで吸収する。

**Files:**
- Modify: `apps/claude-app-server/test/jsonrpc/dispatcher.test.ts`
- Modify: `apps/claude-app-server/test/jsonrpc/transport.test.ts`（同じパターン）

### Step 1: dispatcher.test.ts にヘルパー追加 + フィクスチャ書き換え

```typescript
import { describe, expect, it, vi } from "vitest";
import { Dispatcher, type HandlerContext } from "../../src/jsonrpc/dispatcher.js";
import type { Id } from "../../src/jsonrpc/id.js";
import type { IncomingMessage } from "../../src/jsonrpc/incoming-message.js";

const makeCtx = (): HandlerContext => ({ sendNotification: vi.fn() });

// branded Id を test 用に作るヘルパー。test では既に validate 済みの値を扱う前提なので、
// schema parse のオーバーヘッドを避けつつ型を合わせる。
// 注: Id は branded だが、`as const satisfies Id` は brand を要求するので使えない。
// 代わりに test ヘルパーを Id.schema 経由で作る。
import { Id } from "../../src/jsonrpc/id.js";
const idOf = (raw: number | string): Id => {
  const parsed = Id.schema["~standard"].validate(raw);
  if (parsed instanceof Promise) throw new Error("sync only");
  if (parsed.issues) throw new Error(`invalid id: ${raw}`);
  return parsed.value;
};

const request = (id: Id, method: string, params?: unknown) =>
  ({ kind: "Request", id, method, params }) as const satisfies IncomingMessage;

const notification = (method: string, params?: unknown) =>
  ({ kind: "Notification", method, params }) as const satisfies IncomingMessage;

describe("Dispatcher", () => {
  it("routes a registered request to its handler and returns a Success response", async () => {
    const d = Dispatcher.create();
    d.registerRequest("hello", () => ({ greeting: "hi" }));
    const res = await d.dispatch(request(idOf(1), "hello"), makeCtx());
    expect(res).toEqual({ kind: "Success", id: idOf(1), result: { greeting: "hi" } });
  });

  // ... 他のテストも request(...) / notification(...) で書き換え
});
```

注: `as const satisfies IncomingMessage` で kind の literal type が保たれ、IncomingMessage との互換性も保証される。

### Step 2: transport.test.ts も同様に整理

`expect(collected).toEqual([{ kind: "Request", id: 1, ... }])` の比較先は branded Id を含むオブジェクト。比較は値ベースなので brand は影響しない（runtime では brand は型レベルだけで実体なし）。なので `toEqual` の右辺はそのまま literal で OK。`as const satisfies IncomingMessage` を入れる必然性は低いが、入れたほうが型ドキュメント的に望ましい:

```typescript
expect(collected).toEqual([
  {
    kind: "Request",
    id: 1,
    method: "a",
    params: undefined,
  } as const satisfies IncomingMessage,
  // ...
]);
```

### Step 3: 検証 + コミット

```bash
pnpm exec tsc --noEmit
pnpm test
git add apps/claude-app-server/test
git commit -m "fix(claude-app-server): tighten test fixtures with as const satisfies and branded Id helper"
```

---

## Task 9: 最終確認 + マージ

### Step 1: 全コマンド再実行

```bash
cd /Users/babie/src/github.com/babie/concert/apps/claude-app-server
pnpm exec tsc --noEmit
pnpm test
pnpm lint
pnpm format:check
pnpm build
echo '{"id":0,"method":"initialize","params":{}}' | node dist/bin.js
echo '{"id":1,"method":"thread/start","params":{}}' | node dist/bin.js
node dist/bin.js --permission-mode bogus < /dev/null  # invalid options エラー期待 (exit 2)
```

期待:
- 型チェック: 0 errors
- テスト: 21+ tests PASS（Task 8 でテストヘルパー導入時に件数増えるかも）
- lint: 0 warnings
- format:check: clean
- build: success
- smoke 1: `{"id":0,"result":{...}}`
- smoke 2: `{"id":1,"error":{"code":-32601,...}}`
- smoke 3: stderr に `invalid options:`、exit 2

### Step 2: ブランチをマージ

`finishing-a-development-branch` スキルを使用。または手動で:

```bash
cd /Users/babie/src/github.com/babie/concert
git checkout main
git merge fix/cas-kamae-review --no-ff -m "Merge branch 'fix/cas-kamae-review'

claude-app-server: kamae レビュー指摘の修正一括適用 (1 High + 6 Low)。
- CLI 引数を valibot で境界バリデーション
- Id を Branded Type 化
- Request/Notification を Readonly<>
- DispatchError DU 導入
- 軽微な as キャスト除去
- テストフィクスチャに as const satisfies
"
git branch -d fix/cas-kamae-review
```

### Step 3: メモリ更新

`/Users/babie/.claude/projects/-Users-babie-src-github-com-babie-concert/memory/project_cas_phase1.md` に追記:

```markdown
## kamae レビュー対応 (2026-05-1X)

`docs/superpowers/plans/2026-05-11-cas-kamae-review-fixes.md` に基づき 1 High + 6 Low を修正。
- CLI 引数の境界バリデーション (valibot)
- Id Branded Type 化
- Readonly<> 整合
- DispatchError DU
- 軽微な as 除去
- テストフィクスチャの as const satisfies
```

---

## チェックリスト全体

- [ ] Task 1: ブランチ切り
- [ ] Task 2 [High]: CLI 引数バリデーション
- [ ] Task 3 [Low]: Id Brand
- [ ] Task 4 [Low]: Request/Notification Readonly
- [ ] Task 5 [Low]: DispatchError DU
- [ ] Task 6 [Low]: ファイル分割の判断記録（コメント追記 or 分割）
- [ ] Task 7 [Low]: 軽微な as 除去
- [ ] Task 8 [Low]: テストフィクスチャ as const satisfies
- [ ] Task 9: 最終確認 + マージ + メモリ更新

## 想定リスク・落とし穴

1. **Task 3 と Task 4 は依存関係**: Id が branded になると incoming-message.ts の transform が型不整合を起こす。Task 3 の Step 2 で incoming-message.ts も同時に修正が必要、または Task 3 → Task 4 の順で連続実行。
2. **テスト破損**: Branded Id 導入後、テストの `id: 1` リテラルが `Id` (branded) に代入できなくなる。Task 8 のヘルパー `idOf(1)` を Task 3 完了時点で導入するか、Task 3〜8 を連続で進める。
3. **oxfmt の不安定性**: 過去にバージョン 0.1.0 で型述語破壊の bug があった。現状 0.48.0 で問題ないが、format 後に必ず diff を目視確認。format 適用後 `tsc --noEmit` を再実行して型述語が壊れていないことをチェック。
4. **commander の default 削除**: `--allowed-tools` の default を取ると `opts.allowedTools` が `undefined`。valibot schema で `v.optional` にしているので問題ないはず。型と runtime の両方で確認。
5. **`process.exit(2)` のテスト**: vitest 内で `process.exit` を呼ぶと testRunner が落ちる。bin.ts のテストは書かず、CLI 経由のスモークテストで確認する方針。
