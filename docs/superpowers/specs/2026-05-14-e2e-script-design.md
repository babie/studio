# `scripts/e2e.ts`: 受け入れテストスクリプト — 設計書

**日付:** 2026-05-14
**対象:** TODO.md 実行順 8「`scripts/e2e.sh` で受け入れテスト」
**ステータス:** 設計確定、実装プラン待ち

---

## 背景

Milestone 1 のゴールは「`examples/workflow.claude.md` で Linear issue 1件が `claude-app-server` 経由で処理される」こと。Phase 2 (2026-05-14) で実 Linear (`concert-3f96fb9d18cf` プロジェクトの `CYFY-5`) を使って Symphony → claude-app-server → Claude → Linear のフルパイプラインが動くことを手動で確認済み。

これを **1 コマンドで再現可能な受け入れテスト**として自動化する。CI 化は Milestone 2 以降の課題、当面はローカル開発者が `pnpm e2e` 一発で叩ける状態を目指す。

既存の `docs/e2e_testing.md` には bash 版のサンプル実装が記載されているが、以下の差分で更新する:

1. `mise exec --` 前置を排除 (devShell で nix 経由に統一されたため不要)
2. `scripts/build_all.sh` / `scripts/install_dev.sh` への参照を削除し、`pnpm build` / `pnpm dev:install` に置き換え
3. 実装言語を bash から TypeScript に切り替え (理由は後述)

同じ古い参照は `docs/e2e_testing.md` だけでなく他のドキュメントにも残っているため、リポジトリ全体で網羅的に置き換える (詳細は「変更ファイル一覧」セクション)。

---

## 実装言語選定

候補 (A) モノリシック bash + curl + jq、(B) bash + 補助スクリプト分割、(C) bash + node helper、(D) モノリシック node、を比較し、**(D) 改 TypeScript** を採用。

理由:

- claude-app-server がすでに TS なので、node ランタイムは確実に揃っている (依存追加なし)
- bash の文字列展開で GraphQL を組むより、JS の template literal + `fetch` の方が安全
- kamae スキル (`.claude/skills/kamae/`) を適用して **Result 型 + boundary validation** をきちんと書く方針を採るため、TS が必須

採用ライブラリ (kamae の優先順に従う):

- **Result library**: [`@praha/byethrow`](https://www.npmjs.com/package/@praha/byethrow) (kamae の優先度 2 番目。`neverthrow` は使わない — ユーザ指定)
- **Validation library**: `valibot` (apps/claude-app-server 側にも既存、踏襲)
- **Build**: `tsdown` (ユーザ指定。tsx の実行時 TS ではなく、precompile → node 実行)

依存はすべて **root `package.json` の `devDependencies`** に追加する (production 配布物ではないため)。

---

## 目標

- `pnpm e2e` で受け入れテストが完走 (PASS / FAIL を exit code で表現)
- Linear test issue が前回 `Done` でも、スクリプトが自動で `Todo` に戻して再実行できる (連続実行性)
- 検証は決定的 (`node tmp/hello.js` の stdout 比較、git log 確認)
- 失敗時の error メッセージから原因が即特定できる (discriminated union × `assertNever`)
- 環境変数のテンプレートとして `.env.example` を提供

スコープ外:

- CI 自動化 (Linear / Claude のシークレット運用は別)
- Linear モックサーバ
- 複数 issue の並行検証
- Symphony TUI 出力のリアルタイム解析 (生ログをファイルに落とすのみ)

---

## アーキテクチャ

### ファイル構成

```
/
├── scripts/
│   ├── e2e.ts            # 新規: 受け入れテスト本体 (TypeScript)
│   └── .gitkeep          # 既存
├── .env.example          # 新規: 環境変数テンプレート
├── .env                  # 未 commit (`.gitignore` 済み)、direnv が読む
└── package.json          # devDeps に @praha/byethrow / valibot / tsdown 追加、
                          # "e2e" script を書き換え
```

ビルド成果物 (`scripts/dist/e2e.js` 等) は `.gitignore` 対象。

### 全体フロー

```
e2e.ts main()
  ↓
1. preflight
   ├─ 必須 env (LINEAR_API_KEY, E2E_LINEAR_ISSUE_KEY) を valibot で parse
   ├─ ANTHROPIC_API_KEY があれば warn + delete (Pro/Max サブスク強制)
   └─ 外部コマンド存在チェック (pnpm, mix, node, git)
  ↓
2. cleanWorkspace
   └─ rm -rf ${E2E_WORKSPACE_ROOT}/${E2E_LINEAR_ISSUE_KEY}
  ↓
3. build
   ├─ pnpm build:claude-app-server
   └─ cd apps/symphony && mix compile
  ↓
4. install
   └─ pnpm dev:install
  ↓
5. resetIssueToTodo
   ├─ GraphQL: issue(id=KEY) → issue.id (UUID) + team.states
   ├─ states から name == E2E_LINEAR_RESET_STATE を探す
   └─ GraphQL: issueUpdate(id, input={ stateId })
  ↓
6. runSymphony (並行ループ)
   ├─ spawn ./apps/symphony/bin/symphony --i-understand-...  <workflow>
   │   ├─ cwd = apps/symphony
   │   ├─ env = process.env (direnv 経由で既に LINEAR_API_KEY 等が入っている前提)
   │   └─ stdout/stderr → scripts/e2e.symphony.log (append)
   ├─ 10s ごとに Linear をポーリング:
   │     issue.state.name が terminal_states ("Done"/"Closed"/"Cancelled"/"Canceled"/"Duplicate") なら resolve
   └─ E2E_TIMEOUT_SECONDS 経過なら reject (timeout)
   resolve/reject いずれの場合も Symphony を SIGTERM → 5s 後 SIGKILL
   resolve (terminal 検出) のときだけ次へ進む。reject の場合は verify をスキップして即 Err を上に伝播
  ↓
7. verifyWorkspace (runSymphony が Ok のときのみ実行)
   ├─ ${E2E_WORKSPACE_ROOT}/${E2E_LINEAR_ISSUE_KEY}/tmp/hello.js が存在
   ├─ node tmp/hello.js の stdout が "Hello, World!\n" と等しい
   └─ git -C <ws> log --oneline -- tmp/hello.js が非空
  ↓
8. cleanWorkspace (成功時のみ。失敗時は残してデバッグ用に保持)
  ↓
exit 0 (PASS) / exit ≠0 (FAIL kind by error.kind)
```

各ステップは `ResultAsync<T, E2EError>` を返し、`main()` で `.andThen` で chain。

### `.env.example` の内容

```bash
# Linear Personal API key (Settings → Security & access → Personal API keys)
# Symphony と scripts/e2e.ts の両方が読む
LINEAR_API_KEY=

# scripts/e2e.ts が処理する Linear issue の identifier (例: CYFY-5)
# 必須。state は実行時にスクリプトが Todo (or E2E_LINEAR_RESET_STATE) に戻す
E2E_LINEAR_ISSUE_KEY=

# 以下は省略可 (コメントに記載のデフォルトが使われる)

# リセット先 state 名 (default: Todo)
# E2E_LINEAR_RESET_STATE=Todo

# Symphony に渡す workflow ファイル (default: apps/symphony/examples/workflow.claude.md)
# E2E_WORKFLOW_PATH=apps/symphony/examples/workflow.claude.md

# 検証用 workspace の親ディレクトリ (default: /tmp/concert-e2e/workspaces)
# E2E_WORKSPACE_ROOT=/tmp/concert-e2e/workspaces

# Symphony 起動の上限秒数 (default: 300)
# E2E_TIMEOUT_SECONDS=300
```

初回セットアップはユーザの手動: `cp .env.example .env` してから値を埋める。スクリプトはこのコピーを自動では行わない。

---

## kamae 流の型設計

### 環境変数 schema (boundary defense)

```ts
import * as v from "valibot";

const EnvSchema = v.object({
  LINEAR_API_KEY: v.pipe(v.string(), v.minLength(1)),
  E2E_LINEAR_ISSUE_KEY: v.pipe(v.string(), v.minLength(1)),
  E2E_LINEAR_RESET_STATE: v.optional(v.string(), "Todo"),
  E2E_WORKFLOW_PATH: v.optional(v.string(), "apps/symphony/examples/workflow.claude.md"),
  E2E_WORKSPACE_ROOT: v.optional(v.string(), "/tmp/concert-e2e/workspaces"),
  E2E_TIMEOUT_SECONDS: v.optional(v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(1)), "300"),
});

type Env = v.InferOutput<typeof EnvSchema>;
```

### Linear GraphQL response schema

```ts
const IssueResponseSchema = v.object({
  data: v.object({
    issue: v.object({
      id: v.string(),
      identifier: v.string(),
      team: v.object({
        states: v.object({
          nodes: v.array(v.object({ id: v.string(), name: v.string() })),
        }),
      }),
    }),
  }),
});

const ResetResponseSchema = v.object({
  data: v.object({
    issueUpdate: v.object({
      success: v.boolean(),
      issue: v.object({ state: v.object({ name: v.string() }) }),
    }),
  }),
});

const StatusResponseSchema = v.object({
  data: v.object({
    issue: v.object({ state: v.object({ name: v.string() }) }),
  }),
});
```

### Error 型 (discriminated union)

```ts
type E2EError =
  | { kind: "ConfigError"; issues: ReadonlyArray<string> }
  | { kind: "ToolMissing"; tools: ReadonlyArray<string> }
  | { kind: "BuildFailed"; phase: "claude-app-server" | "symphony"; code: number }
  | { kind: "InstallFailed"; code: number }
  | { kind: "LinearHttpError"; status: number; body: string }
  | { kind: "LinearGraphQLError"; errors: ReadonlyArray<{ message: string }> }
  | { kind: "LinearResponseInvalid"; issues: ReadonlyArray<string> }
  | { kind: "StateNotFound"; want: string; available: ReadonlyArray<string> }
  | { kind: "SymphonySpawnFailed"; cause: string }
  | { kind: "SymphonyTimedOut"; logPath: string }
  | {
      kind: "VerifyFailed";
      check: "fileExists" | "nodeOutput" | "gitCommitted";
      detail: string;
      workspacePath: string;
    }
  | { kind: "Interrupted" };
```

### exit code マッピング

| `error.kind` | exit code |
|---|---|
| (success) | 0 |
| `ConfigError`, `ToolMissing` | 2 |
| `BuildFailed`, `InstallFailed`, `LinearHttpError`, `LinearGraphQLError`, `LinearResponseInvalid`, `StateNotFound`, `SymphonySpawnFailed`, `SymphonyTimedOut`, `VerifyFailed` | 1 |
| `Interrupted` | 130 |

`main()` の末尾で `switch (error.kind)` を網羅、デフォルト分岐に `assertNever(error)` を置いて TypeScript の exhaustiveness check に乗せる。

---

## 主要な実装方針

### Linear GraphQL

issue クエリの引数 `id` は Linear の規約上 UUID と identifier (`CYFY-5`) の両方を受け付ける ([Linear docs](https://developers.linear.app/docs/graphql/working-with-the-graphql-api/queries))。実装フェーズで Context7 経由で再確認するが、Phase 2 でも `{ id: "..." }` で identifier を渡して動作確認済み。

GraphQL 呼び出しは valibot で 2 段に守る:

1. HTTP status が 2xx 系か → 否なら `LinearHttpError`
2. `response.errors` が空か → 非空なら `LinearGraphQLError`
3. body を schema で `safeParse` → 失敗なら `LinearResponseInvalid` (検証エラーを抜粋して保持)

### Symphony の起動と停止判定

`child_process.spawn` で non-blocking 起動、stdout/stderr は `fs.createWriteStream` で `scripts/e2e.symphony.log` に追記。Symphony は永続プロセスなので、以下のいずれかが先に来るまで待つ:

- **Linear polling** が terminal state を検出 → 正常完了 (`Ok`)、検証ステップへ進む
- **タイムアウト** (`E2E_TIMEOUT_SECONDS`) → `Err(SymphonyTimedOut)`、検証スキップ
- **SIGINT** (Ctrl+C) → `Err(Interrupted)`、検証スキップ
- Symphony プロセス自体の **異常終了** → `Err(SymphonySpawnFailed)`、検証スキップ

いずれの場合も `finally` 相当の処理で `child.kill('SIGTERM')` → 5s 待ち → `child.kill('SIGKILL')`。process.on('SIGINT') ハンドラも同様。`Err` の場合は workspace を保持して上位に伝播 (削除しない)。

### Workspace 検証

`fs.existsSync` と `execFile('node', [...])` / `execFile('git', [...])` を `byethrow` でラップ。`node` の stdout は文字列比較 (改行込み)。

### byethrow の使い方の要点

`@praha/byethrow` は `Result.try` でブロックを ResultAsync に変換、`.andThen` / `.map` / `.mapErr` で chain。実装フェーズで `result-libraries/byethrow.md` (kamae 配下) を読んでスタイルを揃える。

---

## 変更ファイル一覧 (実装プラン用)

### 新規

- `scripts/e2e.ts`
- `.env.example`

### 更新 (実装スコープ)

- `package.json` (root) — `devDependencies` に `@praha/byethrow`, `valibot`, `tsdown`, `@types/node` (もし未) を追加、`"e2e"` script を `tsdown` 推奨の流儀に書き換え (build + node 実行)
- `.gitignore` — `scripts/dist/` を追加 (`.env` / `.env.example` は既存ルールでカバー)

### 更新 (ドキュメント整合)

`grep -rnE "scripts/e2e\.sh|scripts/build_all\.sh|scripts/install_dev\.sh|mise exec"` で網羅した置き換え:

- `CLAUDE.md` (ルート) — `scripts/e2e.sh` 参照を `scripts/e2e.ts` (もしくは `pnpm e2e`) に、サンプル中の `mise exec --` を削除
- `README.md` (ルート) — `build_all.sh` / `install_dev.sh` / `scripts/e2e.sh` / `mise exec` 参照を最新コマンドに
- `TODO.md` — 実行順 6 の括弧 (`install_dev.sh`, `build_all.sh`) を `pnpm build` / `pnpm dev:install` に、実行順 8 と Milestone 1 完了条件のチェック更新
- `docs/e2e_testing.md` — bash 版サンプル → TS 版に書き換え、`mise exec` / `build_all.sh` / `install_dev.sh` 参照を全面置換、`.env.example` セクションを追加
- `docs/adr/0001-adopt-monorepo.md` — `scripts/e2e.sh` 言及を更新
- `apps/claude-app-server/CLAUDE.md` — `scripts/e2e.sh` 参照を更新、完了条件「`scripts/e2e.sh` 統合」のチェック更新
- `apps/symphony/CLAUDE.md` — `mise exec` 例の削除、完了条件「`scripts/e2e.sh` 統合」のチェック更新

### 触らない

- `apps/symphony/README.md` / `apps/symphony/WORKFLOW.md` — 本家 Symphony 由来、本家追従しない方針。自分用ドキュメントはルート CLAUDE.md と `examples/workflow.claude.md` でカバー
- `docs/superpowers/specs/*` / `docs/superpowers/plans/*` の過去設計書 — 当時の状態を履歴として保存

### Linear 側で必要な作業 (ユーザ手動、本実装の commit には含めない)

- `CYFY-5` の description を `docs/e2e_testing.md` 5.1 節の `tmp/hello.js` 仕様に書き換える
- 初回は `.env.example` を `.env` にコピーして `E2E_LINEAR_ISSUE_KEY=CYFY-5` を埋める

---

## 受け入れ条件

### 機能

1. `pnpm e2e` 単発で `PASS`、exit 0
2. **連続 2 回成功** — 1 回目で issue が Done に遷移後、2 回目を起動して自動リセット → 再処理 → PASS
3. `LINEAR_API_KEY` を unset → `ConfigError`、exit 2、欠落 env 名が表示される
4. `E2E_LINEAR_ISSUE_KEY=BOGUS-9999` で実行 → `LinearGraphQLError` か `LinearResponseInvalid`、exit 1
5. `E2E_TIMEOUT_SECONDS=5` で実行 → `SymphonyTimedOut`、exit 1、`scripts/e2e.symphony.log` のパス案内
6. 検証段階で stdout 不一致を作為的に発生させる → `VerifyFailed`、exit 1、workspace 保持

### 運用

- ANSI escape 入りの Symphony TUI 出力が `scripts/e2e.symphony.log` に追記 (上書きしない)
- 成功時の workspace は削除、失敗時は保持して絶対パス表示
- SIGINT で Symphony 子プロセスを kill、exit 130
- すべての error は `assertNever` でコンパイル時に網羅性が担保される

---

## 関連ドキュメント

- ルート [`CLAUDE.md`](../../../CLAUDE.md)
- [`docs/e2e_testing.md`](../../e2e_testing.md) — E2E 全体手順 (本 spec 実装時に更新)
- [`TODO.md`](../../../TODO.md) — 実行順 8
- [`.claude/skills/kamae/`](../../../.claude/skills/kamae/) — TypeScript 型設計の流儀
