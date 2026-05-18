# `apps/claude-app-server` Phase 4 (削減版) — 設計

**日付**: 2026-05-12
**対象**: `concert` モノレポ / `apps/claude-app-server`
**ブランチ**: `feat/cas-phase4`
**関連**: [`TODO.md`](../../../TODO.md), [`apps/claude-app-server/CLAUDE.md`](../../../apps/claude-app-server/CLAUDE.md), [`docs/protocol.md`](../../protocol.md)

---

## 1. 背景

`apps/claude-app-server` の Phase 3 までで thread/turn の基本フロー、tool マッピング、`closeAll` による pending クローズが完了している (131 tests PASS, main マージ済み `8a62247`)。Phase 4 は TODO.md で「仕上げ」として以下の 6 項目が列挙されていた:

1. stub ハンドラ
2. レート制限ハンドリング (`turn/completed status:failed` + `codexErrorInfo: "UsageLimitExceeded"`)
3. トークン使用量集計 + `thread/tokenUsage/updated` 通知
4. `partial messages` で `text_delta` ストリーミング
5. README とサンプル
6. Symphony 由来 Codex 固有フィールドの無視

このうち **3 と 4** は Symphony Phase 2 (E2E 実機検証) には必須ではなく、本番投入時 (Milestone 4 後) でも進行表示は `item/started` → `item/completed` シーケンスで足り、Pro/Max は定額なのでコスト集計の不在も致命傷ではない。よって **Phase 4 のスコープを (1)(2)(5)(6) に絞り、(3)(4) は Milestone 1 から外して Milestone 2 以降に延期**する。延期項目は TODO.md 末尾の「Milestone 2 以降」リストに「`apps/claude-app-server` ストリーミング & トークン使用量対応」として記載済み。本番投入直前に再判定する。

---

## 2. スコープ (確定版)

| # | 項目 | Phase 4 で実施 |
|---|---|---|
| 1 | stub ハンドラ ((iii) 拡張可能フレーム) | ✅ |
| 2 | レート制限ハンドリング (`rate_limit_event` 優先 + フォールバック) | ✅ |
| 3 | Symphony 由来 Codex 固有フィールドの無視テスト | ✅ |
| 4 | README 更新 (延期項目の明記 + UsageLimitExceeded + stub 記述) | ✅ |
| 5 | TODO.md 更新 (延期項目を Milestone 2 以降に追加) | ✅ |
| ─ | partial messages / `text_delta` ストリーミング | Milestone 2 以降 |
| ─ | `thread/tokenUsage/updated` 通知 | Milestone 2 以降 |

---

## 3. 設計詳細

### 3.1 stub ハンドラ — `src/handlers/stub.ts`

CLAUDE.md と `docs/protocol.md` を突き合わせ、Symphony が送らないメソッド一覧 (`account/*`, `fs/*`, `thread/fork`, `thread/list`, `turn/steer`, `command/exec`, など) は dispatcher のデフォルト `-32601` で十分。明示的にスタブ応答が必要なのは:

- `mcpServerStatus/list` → 空配列で応答 (任意、CLAUDE.md より)
- `thread/resume` → 当面は dispatcher デフォルトの `-32601` に任せる (擬似応答の合意が未定)

設計:

```ts
// src/handlers/stub.ts
import type { Dispatcher } from "../jsonrpc/dispatcher.js";

export const registerStub = (
  dispatcher: Dispatcher,
  method: string,
  response: unknown,
): void => {
  dispatcher.registerRequest(method, async () => response);
};

export const registerStubs = (dispatcher: Dispatcher): void => {
  registerStub(dispatcher, "mcpServerStatus/list", { servers: [] });
  // 将来擬似応答を追加するときはここに registerStub(...) を足す
};
```

`handlers/index.ts` から `registerStubs(dispatcher)` を呼ぶ。`registerStub` の export だけで「擬似応答を増やしたければここに行を足す」というシグナルになる。

#### テスト
- `registerStubs` 適用後の dispatcher に `mcpServerStatus/list` を投げると `{ servers: [] }` が返る
- 未登録メソッド (`account/login` 等) は `-32601` が返る (回帰テスト)

### 3.2 レート制限ハンドリング

#### `rate_limit_event` の検出

Claude Agent SDK は `type: 'rate_limit_event'` のメッセージを query() のイテレータに流す。`rate_limit_info.status` / `rate_limit_info.overageStatus` に `'rejected'` が入ったら usage limit に達したと判定。

`src/claude/sdk-message.ts`:

```ts
// 新規 schema
const RateLimitInfoSchema = v.looseObject({
  status: v.optional(v.picklist(["allowed", "allowed_warning", "rejected"])),
  overageStatus: v.optional(v.picklist(["allowed", "allowed_warning", "rejected"])),
});

const RateLimitEventSchema = v.object({
  type: v.literal("rate_limit_event"),
  rate_limit_info: RateLimitInfoSchema,
  session_id: v.string(),
});

// 新規 kind
| Readonly<{
    kind: "RateLimit";
    status: "allowed" | "allowed_warning" | "rejected";
    sessionId: string;
  }>
```

`SdkMessage.parse` で `RateLimitEventSchema` を試し、`rate_limit_info.status === "rejected"` か `overageStatus === "rejected"` なら `status: "rejected"`、それ以外なら `status: rate_limit_info.status ?? "allowed"`。

#### Session 側の状態とエラー伝播

`src/claude/session.ts` 内で turn-scoped に `usageLimitHit: boolean` を保持。

- `parsed.kind === "RateLimit"` のとき `parsed.status === "rejected"` なら `usageLimitHit = true`
- 例外 catch / ResultError の経路で `status: "failed"` に倒す際、
  - `usageLimitHit` が true → `error.codexErrorInfo = "UsageLimitExceeded"`
  - フォールバック: `error.message` または `errors` を結合した文字列に `/rate.?limit|usage.?limit|quota/i` がマッチすれば同じく `codexErrorInfo = "UsageLimitExceeded"`
- どちらも該当しなければ generic な `{ message }` のみ

#### `turn.error` の型拡張

現状 `{ message: string } | null`。今回 `{ message: string; codexErrorInfo?: string } | null` に拡張。`turn/completed` の `turn.error` payload に反映。

#### テスト

- `SdkMessage.parse`: `rate_limit_event` で `status: "rejected"` のケースが `kind: "RateLimit"` にパースされる
- `SdkMessage.parse`: `rate_limit_info.overageStatus === "rejected"` でも `status: "rejected"` 判定
- Session: `RateLimit (rejected)` + `ResultError` の流れで `turn.error.codexErrorInfo === "UsageLimitExceeded"` が出る
- Session: `RateLimit` 無しでも例外 message に `rate limit` 含むなら `UsageLimitExceeded` に昇格
- Session: 関係ない `ResultError` は `codexErrorInfo` 無しの generic error

### 3.3 Codex 由来フィールド無視テスト

実装は既に `looseObject` で受けているはずだが、回帰テストとして固定する:

- `test/handlers/thread.test.ts` に `approvalPolicy: "never"`, `sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/tmp"], networkAccess: true }`, `effort: "low"` を含む `thread/start` を投げ、エラーにならず `thread/started` 通知 + `{ thread: { id } }` レスポンスが返ることを確認
- `test/handlers/turn.test.ts` も同様に `turn/start` の params に不明フィールド (`approvalPolicy`, `sandboxPolicy`) を入れて通る

新規実装は不要 (looseObject による寛容パースが既に効いている)。テスト追加のみ。

### 3.4 README 更新

`apps/claude-app-server/README.md`:

- 「Codex App Server 本家との既知の差異」テーブル
  - `thread/tokenUsage/updated`: `Phase 4 で対応予定` → `Milestone 2 以降に延期 (本番投入直前に再判定)`
  - `outputDelta` 系の備考は据え置き (Milestone 2 以降の partial 対応で改善見込み)
- 新セクション「未実装メソッド」追加: dispatcher デフォルトで `-32601`、`mcpServerStatus/list` は空配列を返す、他は stub.ts の `registerStub` で擬似応答を後付け可能 — の旨を簡潔に
- 新セクション「レート制限」追加: usage limit に達したターンは `turn/completed status:failed` + `error.codexErrorInfo: "UsageLimitExceeded"` で抜ける旨

### 3.5 TODO.md 更新

#### Phase 4 セクション
チェックリスト本文を以下に書き換え:

- [ ] 未実装メソッド用 `stub` ハンドラ (`registerStub` helper + `mcpServerStatus/list` → `{ servers: [] }`)
- [ ] レート制限ハンドリング (`rate_limit_event` 検出 → `turn/completed status:failed` + `error.codexErrorInfo: "UsageLimitExceeded"`)
- [ ] Symphony 由来 Codex 固有フィールド (`approvalPolicy`, `sandboxPolicy` 等) の無視を回帰テストで固定
- [ ] README とサンプル

#### 延期項目を Milestone 2 以降に追加
TODO.md 末尾の「Milestone 2 以降 (予定、詳細は後日)」リストに新項目「**`apps/claude-app-server` ストリーミング & トークン使用量対応**」を追加:

- partial messages (`includePartialMessages: true` で `stream_event` → `item/agentMessage/delta`)
- partial と最終 `assistant` メッセージの重複吸収
- `thread/tokenUsage/updated` 通知 (`input_tokens` / `output_tokens` / `cache_*` を独自 camelCase スキーマで)
- 累積 (per-thread) を `state/threads.ts` に持たせる
- **着手判定**: 本番投入直前 (Milestone 4 後) に再判定。Conductor 設計時にストリーミング必須要件が出たら前倒し

#### 実行順
1〜4 は完了済み (変更なし)
5. claude-app-server Phase 4 (削減版)
6. モノレポ統合 (`scripts/install_dev.sh`, `scripts/build_all.sh`)
7. symphony Phase 2 (実機結合)
8. `scripts/e2e.sh` 受け入れテスト

---

## 4. 影響範囲と非対象

### 変更ファイル
- `src/handlers/stub.ts` (新規)
- `src/handlers/index.ts` (registerStubs 呼び出し追加)
- `src/claude/sdk-message.ts` (RateLimit kind 追加)
- `src/claude/session.ts` (usageLimitHit + error 拡張)
- `src/handlers/turn.ts` (turn.error の型拡張は server 側ペイロードのみ、内部表現と一致させる)
- `test/handlers/stub.test.ts` (新規)
- `test/handlers/thread.test.ts` (Codex フィールド無視テスト追加)
- `test/handlers/turn.test.ts` (Codex フィールド無視テスト追加)
- `test/claude/sdk-message.test.ts` (RateLimit ケース追加)
- `test/claude/session.test.ts` または `test/server.test.ts` (usageLimit エラー伝播テスト)
- `apps/claude-app-server/README.md`
- `TODO.md`

### 非対象
- `thread/tokenUsage/updated` 通知 → Milestone 2 以降 (本番投入直前に再判定)
- partial messages / `text_delta` ストリーミング → Milestone 2 以降 (本番投入直前に再判定)
- `outputDelta` 系 (commandExecution / fileChange) → Milestone 2 以降の partial 対応で部分改善見込み、引き続き本家差異あり
- `thread/resume` の擬似応答 → 当面 `-32601` (ニーズに応じて将来 stub.ts 拡張)

---

## 5. 検証基準

- `pnpm test` が全件 PASS (新規テストが緑)
- `pnpm lint` (oxlint) と `pnpm format:check` (oxfmt) がクリーン
- `pnpm build` (tsc) がエラーなく通る
- 手動シナリオ (`examples/manual_test.jsonl`) が Phase 3 と同等に動作 (回帰なし)

---

## 6. 未確定事項 / リスク

- **`rate_limit_event` の実機挙動**: SDK が `status: "rejected"` を流した後どのように `result` を吐くかは未検証。Symphony Phase 2 の実機 E2E でハマったら本フェーズの分類ロジックを補正する想定。
- **`SDKResultError.errors[]` の rate limit メッセージ文言**: テキストマッチは脆いので、最初は `/rate.?limit|usage.?limit|quota/i` の最小パターンに留め、実機ログを見て調整する。
- **`turn.error.codexErrorInfo` 拡張の SPEC 整合性**: `docs/protocol.md` §9 と一致している (`UsageLimitExceeded` をそのままタグとして運ぶ)。
