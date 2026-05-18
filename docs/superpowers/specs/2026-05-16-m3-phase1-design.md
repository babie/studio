# Milestone 3 Phase 1: `apps/conductor` bootstrap + Memory tracker happy path 設計書

**日付:** 2026-05-16
**対象:** [`TODO.md`](../../../TODO.md) Milestone 3 Phase 1
**親 spec:** [`2026-05-15-m3-overview-design.md`](2026-05-15-m3-overview-design.md)
**ステータス:** 設計確定、実装着手待ち

---

## 背景

M3 overview ([`2026-05-15-m3-overview-design.md`](2026-05-15-m3-overview-design.md)) で確定したとおり、`apps/symphony` (Elixir) を `apps/conductor` (TS) に書き直す。本 spec は **Phase 1** の実装範囲を確定する。

Phase 1 のゴールは「`apps/conductor/` を TS で立ち上げ、Memory tracker + Mock backend で 1 issue を `Todo → Done` に内部遷移できる happy path を通すこと」。実 backend (claude-app-server / codex) との subprocess 通信と Workspace 管理は Phase 2 で扱う。

---

## スコープ

### スコープ in

- `apps/conductor/` パッケージの新規セットアップ（package.json / tsconfig / vitest.config / commander エントリ）
- pnpm workspace 登録、`pnpm dev:install` を conductor リンクに拡張
- ルート `tsconfig.base.json` の新設と、`apps/claude-app-server` / `apps/conductor` / `apps/e2e` の `tsconfig.json` を `extends` 形式に統一
- `apps/e2e/lib/common.ts` に backend command を中央化する先行リファクタ（Phase 1 では切替先はまだ symphony のまま）
- WORKFLOW.md パーサ（js-yaml + valibot で schema 検証）— **全 schema を一気に書く**（agent / claude / codex / mock / tracker / memory / linear / github / workspace 等）。Markdown 本文（prompt template）は `WorkflowConfig.prompt: string` に raw 格納するだけ（render は Phase 2）
- `agent.type` に `mock` を追加（contributor 向け、README には載せない）
- Memory tracker adapter（symphony の `tracker/memory.ex` 相当を TS で実装、5 関数 interface）
- Mock backend（subprocess 起動なし、in-process で即時 success）
- 最小 Orchestrator skeleton + AgentRunner（1 issue 直列処理）
- 行ログのみの stdout 出力（TUI dashboard は Phase 5）
- redact 機構（`api_key` 等の PII を log から落とす）
- `examples/workflow.mock-memory.md` を新規追加
- ルート `CLAUDE.md` / `docs/architecture.md` の `agent.type: mock` 追記、`apps/conductor/CLAUDE.md` と `apps/conductor/README.md` の新規作成

### スコープ out（Phase 2 以降）

- 実 backend (claude-app-server / codex) の subprocess 起動・JSON-RPC stdio 通信
- Workspace 管理（`git clone`、`workspace.hooks.*`）
- prompt builder (liquidjs)
- Linear / GitHub tracker adapter（schema は受けるが実装は Phase 3-4）
- TUI dashboard、event bus、token usage 集計
- 並行実行 (`max_concurrent_agents > 1`)、リトライ、ファイルロガー
- guardrails flag (`--i-understand-...`)

### 成功基準（Phase 1 完了の自動検証）

`pnpm --filter conductor test` で以下の 3 段が全て green:

1. **in-source unit tests**（domain / config / tracker / backend / orchestrator / util の各モジュール）
2. **integration test** (`test/integration/mock-memory-happy-path.test.ts`): `WorkflowConfig` を渡して `orchestrator.run` を呼び、全 issue が `done_state` になっていることを検証
3. **e2e test** (`test/e2e/conductor-cli.test.ts`): `child_process.spawn('conductor', ['examples/workflow.mock-memory.md'])` を起動し、stdout の行ログ（`[orchestrator] picked ...`, `[backend mock] turn complete ...`, `[orchestrator] ... -> Done`）を正規表現 assert

加えて、既存の `pnpm test:e2e:claude-linear` / `pnpm test:e2e:claude-github` は **symphony 起動のまま緑を維持**（Phase 1 では conductor に切替えない）。

---

## 横断指針

M3 overview の横断指針を踏襲。Phase 1 で追加・確定する事項:

- **`agent.type` の許容値**: `claude` / `codex` / `mock` の 3 値。`mock` は contributor 向け、README には載せない。
- **`mock:` ブロック**: `agent.type: mock` のとき任意で配置可。Phase 1 では `delay_ms` と `force_fail`（テスト用隠し機能）のみ。
- **作業順序**: インフラファースト → bottom-up。`tsconfig.base.json` → `apps/conductor/` 雛形 → workspace 登録 → e2e/common.ts リファクタ → domain → config → tracker → backend → orchestrator → cli → 統合 / e2e テスト → docs。
- **in-source test** (`import.meta.vitest`) を採用。`vitest.config.ts` の `define` で本番 build 時の dead-code elimination を効かせる。

---

## アーキテクチャとデータフロー

### コンポーネント関係図（Phase 1 完了時点）

```
                              apps/conductor
┌──────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  bin.ts ─► cli/run.ts ─► config/loader ─► config/parser              │
│                              │              (js-yaml + valibot)       │
│                              ▼                                        │
│                        WorkflowConfig (kamae: discriminated union)    │
│                              │                                        │
│           ┌──────────────────┴────────────┐                          │
│           ▼                               ▼                           │
│   tracker/memory ◄────── orchestrator ─────► backend/mock            │
│   (Tracker iface)        (1 ループ)        (Backend iface)            │
│           │                  │                    │                   │
│           │                  ▼                    │                   │
│           │              orchestrator/             │                   │
│           │              agent-runner              │                   │
│           │              (issue 1 件分の制御)        │                   │
│           │                                        │                   │
│           ▼                                        ▼                   │
│   in-memory issues (WORKFLOW.md memory: から)   即時 completed 応答    │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### データフロー

1. **起動**: `conductor examples/workflow.mock-memory.md` を CLI が受ける。
2. **Load**: `config/loader` が markdown frontmatter (`---` 区切り) を切り出す。
3. **Parse**: `config/parser` が `js-yaml.load` → `v.parse(WorkflowConfigSchema)` で `WorkflowConfig` に検証。
4. **Tracker 構築**: `tracker.kind === "memory"` なので `memory:` ブロックの `issues` から `Tracker.Memory` インスタンスを初期化。
5. **Backend 構築**: `agent.backend.type === "mock"` なので `Backend.Mock` をインスタンス化。
6. **Orchestrator ループ**: tracker から候補 issue を取得（`fetchCandidateIssues` または `fetchIssuesByStates(activeStates)` を symphony 実装に合わせて選択）→ 各 issue について `AgentRunner.run`:
   1. `tracker.updateIssueState(issue, doingState)`（`doingState` 設定時のみ）
   2. `backend.runIssueTurn(issue, ...)` → Mock が `{ completed: true }` を即時返す
   3. `tracker.updateIssueState(issue, doneState)`（`doneState` 設定時のみ）
7. **stdout**: 各ステップで 1 行ログ。`[orchestrator] picked MEMORY-1 (Todo)` / `[backend mock] turn complete MEMORY-1` / `[orchestrator] MEMORY-1 -> Done`。

---

## モジュール詳細

### `domain/`

kamae 準拠で 1 file 1 module。Phase 1 で確定する型のみ列挙。

| ファイル | 主な型 |
|---|---|
| `domain/issue.ts` | `IssueId`, `IssueIdentifier`, `IssueStateName`（branded type）, `Issue` |
| `domain/backend-config.ts` | `BackendConfig` discriminated union (`claude` / `codex` / `mock`) |
| `domain/agent-config.ts` | `AgentConfig`（`backend: BackendConfig`, `maxConcurrentAgents`, `maxTurns`） |
| `domain/tracker-config.ts` | `TrackerConfig` discriminated union (`memory` / `linear` / `github`) + 共通フィールド (`activeStates` / `terminalStates` / `doingState` / `doneState`) |
| `domain/workspace-config.ts` | `WorkspaceConfig`（Phase 1 では shape 定義のみ、orchestrator は参照しない） |
| `domain/workflow-config.ts` | `WorkflowConfig`（上記すべてを合成） |
| `domain/errors.ts` | `ConfigError` / `TrackerError` / `BackendError` / `OrchestratorError` の discriminated union |

`AgentConfig` は `agent:` ブロック全体、`BackendConfig` は `type` で選ばれる内側の discriminated union（claude / codex / mock）。両者を別名で扱う。

### YAML 表記と TS 型の対応

WORKFLOW.md の YAML 表記（人間が書く）と、`WorkflowConfig` TS 型（内部表現）はネスト構造が異なる。`config/parser.ts` で valibot transform を通して変換する。

**YAML（人間が書く形）**:

```yaml
agent:
  type: mock           # backend discriminator
  max_concurrent_agents: 1
  max_turns: 1

mock:                  # agent.type に対応する backend ブロック
  delay_ms: 0
```

**TS 型（変換後）**:

```ts
type AgentConfig = {
  backend: BackendConfig;   // ← YAML の agent.type + mock: ブロック が合流
  maxConcurrentAgents: number;
  maxTurns: number;
};

type BackendConfig =
  | { type: "claude"; command: string }
  | { type: "codex"; command: string; approvalPolicy: ...; threadSandbox: ...; turnSandboxPolicy: ... }
  | { type: "mock"; delayMs?: number; forceFail?: boolean };
```

変換規則:

1. YAML 上の `agent.type` 値（`claude` / `codex` / `mock`）で、対応する `claude:` / `codex:` / `mock:` ブロックを参照
2. snake_case → camelCase （`max_concurrent_agents` → `maxConcurrentAgents`、`delay_ms` → `delayMs`）
3. 参照したブロックを `agent.backend` フィールドに合流させ、`backend.type` を discriminator にした TS 型に組み立てる

`tracker:` ブロックも同様: YAML の `tracker.kind` + `memory:` / `linear:` / `github:` ブロックを、TS の `TrackerConfig` discriminated union に変換する。

この transform は `config/parser.ts` の責務とし、テスト（in-source）で YAML → TS 型の対応を検証する。

### `config/`

| ファイル | 責務 |
|---|---|
| `config/schema.ts` | valibot で全 schema 定義（Phase 1 で完了、Phase 2-4 では参照のみ）。YAML 表記用 schema + TS 型用 schema + 両者を結ぶ transform を定義 |
| `config/loader.ts` | ファイル読み込み + frontmatter 切り出し。`Result<{ frontmatter, body }, ConfigError>` |
| `config/parser.ts` | `js-yaml.load` → schema 適用 + transform → `WorkflowConfig`。`Result<WorkflowConfig, ConfigError>` |

### `tracker/`

| ファイル | 責務 |
|---|---|
| `tracker/types.ts` | `Tracker` interface (5 関数: `fetchCandidateIssues` / `fetchIssuesByStates` / `fetchIssueStatesByIds` / `createComment` / `updateIssueState`)。symphony の Tracker behaviour を踏襲 |
| `tracker/memory.ts` | `WorkflowConfig.tracker`（kind = memory）から in-memory 配列を保持。`updateIssueState` で内部配列を mutate（次の `fetchIssuesByStates` で結果が変わる） |

Linear / GitHub adapter は Phase 3-4 で追加。

### `backend/`

| ファイル | 責務 |
|---|---|
| `backend/types.ts` | `Backend` interface (`runIssueTurn(issue, opts): Promise<Result<TurnResult, BackendError>>`)、`TurnResult` 型 |
| `backend/mock.ts` | `delayMs` 待機後に `{ completed: true }` を返す。`mock.force_fail` で `BackendError` を返す経路を 1 つ持つ |

実 backend は Phase 2 で `backend/jsonrpc-subprocess.ts` 等として追加予定。

### `orchestrator/`

| ファイル | 責務 |
|---|---|
| `orchestrator/orchestrator.ts` | `run(config, deps): Promise<Result<RunSummary, OrchestratorError>>`。tracker から候補 issue を取得し、逐次 `AgentRunner.run` を呼ぶ |
| `orchestrator/agent-runner.ts` | issue 1 件分の制御。`doingState` mutation → `backend.runIssueTurn` → `doneState` mutation |

Phase 1 では並列なし、リトライなし、event bus なし。

### `cli/`

| ファイル | 責務 |
|---|---|
| `cli/run.ts` | `conductor <workflow.md>` の実装本体。`loader → parser → tracker 構築 → backend 構築 → orchestrator.run` を順に呼ぶ。stdout ロガーをここで注入 |

`src/bin.ts` は commander の宣言だけ持ち、`cli/run.ts` に処理を委譲する薄いシェル。

### `util/`

| ファイル | 責務 |
|---|---|
| `util/logger.ts` | `{ info(msg), error(err) }` の素朴なインタフェース。stdout / stderr に行ログ |
| `util/redact.ts` | `WorkflowConfig` から `api_key` 等の PII を `*****` にマスクする `redactConfig()` |
| `util/result.ts` | byethrow の再エクスポート + Phase 1 で必要な小さなユーティリティ |

---

## エラーハンドリングとログ

### Result 型の運用

すべての boundary 関数 (`config/loader`, `config/parser`, `tracker/*`, `backend/*`, `orchestrator/run`) は `Result<T, E>`（byethrow）で返す。throw は内部実装の最終手段（valibot 例外、Node API 例外）のみ。

### エラー discriminated union

```ts
export type ConfigError =
  | { kind: "file-not-found"; path: string }
  | { kind: "frontmatter-missing"; path: string }
  | { kind: "yaml-parse-failed"; path: string; cause: string }
  | { kind: "schema-violation"; path: string; issues: SchemaIssue[] };

export type TrackerError =
  | { kind: "unknown-state"; state: string }
  | { kind: "issue-not-found"; id: string };

export type BackendError =
  | { kind: "mock-forced-failure"; reason: string };

export type OrchestratorError =
  | { kind: "config"; error: ConfigError }
  | { kind: "tracker"; error: TrackerError }
  | { kind: "backend"; error: BackendError };
```

`cli/run.ts` の出口で 1 箇所だけ `kind` 別に stderr 出力 + `process.exit(1)`。

### ログレベル

Phase 1 では 2 系統のみ:

| 系統 | 出力先 | 内容 |
|---|---|---|
| info | stdout | `[orchestrator] picked MEMORY-1 (Todo)` 等 |
| error | stderr | `[error] schema-violation: ...` 1 行サマリ |

`util/logger.ts` は将来 file logger / level filtering に差し替えやすい形に。

### PII 保護

- `linear.api_key` / `github.api_key` を schema 上は受ける（Phase 3-4 で使う）が、Phase 1 では参照しない。
- `WorkflowConfig` を log / error message に乗せる経路で `redactConfig()` を必ず通す。
- schema-violation 時に config 全体を吐く実装にしないよう、`util/redact.ts` を最初から導入してテスト追加。

---

## テスト戦略

### 配置ルール

| テストの種類 | 配置 | 例 |
|---|---|---|
| Unit | **in-source** (`if (import.meta.vitest)`) | `config/parser.ts`, `tracker/memory.ts`, `backend/mock.ts`, `util/redact.ts` |
| 結合 | `test/integration/` | `orchestrator → tracker → backend` の wiring |
| E2E | `test/e2e/` | `conductor` CLI を子プロセス起動して stdout を assert |

`test/e2e/` を `apps/e2e/` に置かず conductor 内に置く理由: conductor 単独で完結する happy path テストは依存解決が単純になり、Phase 3-4 で `apps/e2e/` に行く linear/github E2E と責務を分離できる。

### vitest.config.ts

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    includeSource: ["src/**/*.ts"],
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  define: {
    "import.meta.vitest": "undefined",
  },
});
```

### Phase 1 で書くテスト

| ファイル | 種類 | 主な検証 |
|---|---|---|
| `config/loader.ts` (in-source) | unit | frontmatter 切り出し、ファイル無し → `file-not-found` |
| `config/parser.ts` (in-source) | unit | YAML パース成功、`agent.type: mock` 認識、schema 違反で `schema-violation` |
| `config/schema.ts` (in-source) | unit | 各 discriminated union が valibot で意図どおり認識される |
| `tracker/memory.ts` (in-source) | unit | `fetchCandidateIssues` / `updateIssueState` で内部配列が変化する |
| `backend/mock.ts` (in-source) | unit | 通常 success、`force_fail: true` で `mock-forced-failure` |
| `orchestrator/agent-runner.ts` (in-source) | unit | `doingState` / `doneState` mutation が正しい順序で呼ばれる、未設定なら skip |
| `orchestrator/orchestrator.ts` (in-source) | unit | 候補が複数あれば順次処理 |
| `util/redact.ts` (in-source) | unit | `api_key` 等が `*****` にマスクされる |
| `test/integration/mock-memory-happy-path.test.ts` | integration | `WorkflowConfig` を渡して orchestrator.run → 全 issue が Done になっている |
| `test/e2e/conductor-cli.test.ts` | e2e | `child_process.spawn('conductor', [...])` で stdout の行ログを正規表現 assert |

---

## インフラ作業

### `tsconfig.base.json`（新規）

ルート直下 `/workspace/tsconfig.base.json`。既存 `apps/claude-app-server/tsconfig.json` と `apps/e2e/tsconfig.json` が共有していた compilerOptions の **union のみ** を入れる（NodeNext/NodeNext 等を採用、追加の strict flag は base には入れない — claude-app-server 既存コードが壊れないことを優先）。`noUncheckedIndexedAccess` や `exactOptionalPropertyTypes` を入れたい場合は `apps/conductor/tsconfig.json` の package-local override で導入する。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

各 `apps/*/tsconfig.json` を以下の形に統一:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

既存の `apps/claude-app-server/tsconfig.json` / `apps/e2e/tsconfig.json` も同じ形に書き換える。

### pnpm workspace 登録 & `pnpm dev:install` 拡張

`pnpm-workspace.yaml` の `packages` に `apps/conductor` を追加。

ルート `package.json` の `dev:install` / `dev:uninstall` script を symphony + claude-app-server + conductor の 3 つに拡張。

### `apps/e2e/lib/common.ts` リファクタ

`resolveBackendCommand(choice: "symphony" | "conductor"): { cmd, args }` を導入。Phase 1 では `claude-linear.ts` / `claude-github.ts` から `resolveBackendCommand("symphony")` を呼ぶ形に差し替え、挙動は不変。

---

## CLI 表面

```
$ conductor <workflow.md>
$ conductor --help
$ conductor --version
```

サブコマンド形式にはせず、第一引数を WORKFLOW.md path として受ける。symphony の `--i-understand-that-this-will-be-running-without-the-usual-guardrails` flag は Phase 1 では入れない（Mock backend のみで実害がない）。Phase 2 で実 backend を spawn する直前に同等 flag を導入する。

commander の最小定義:

```ts
program
  .name("conductor")
  .description("Conductor — agent orchestrator for memory/linear/github trackers")
  .version(pkg.version)
  .argument("<workflow>", "path to WORKFLOW.md")
  .action(async (workflow) => { /* cli/run.ts に委譲 */ });
```

---

## `examples/workflow.mock-memory.md`

```yaml
---
agent:
  type: mock
  max_concurrent_agents: 1
  max_turns: 1

mock:
  delay_ms: 0

tracker:
  kind: memory
  doing_state: In Progress
  done_state: Done

memory:
  issues:
    - id: MEMORY-1
      identifier: MEMORY-1
      title: Sample issue 1
      description: Phase 1 happy path
      state: Todo
    - id: MEMORY-2
      identifier: MEMORY-2
      title: Sample issue 2
      description: Phase 1 second issue
      state: Todo
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.
```

Liquid タグは Phase 2 で実 render する。Phase 1 では schema に prompt 本文として格納されるだけ。

---

## ドキュメント更新（Phase 1 範囲）

| ファイル | 更新内容 |
|---|---|
| ルート [`CLAUDE.md`](../../../CLAUDE.md) 「凍結事項」セクション | `agent.type` の許容値に `mock` を追加（contributor 注意書きとして「開発用、本番 WORKFLOW.md では使わない」と明記） |
| ルート [`CLAUDE.md`](../../../CLAUDE.md) 「ディレクトリ構成」 | `apps/conductor/` を追記 |
| ルート [`README.md`](../../../README.md) | 更新しない（一般ユーザ向け、conductor は Phase 7 で symphony を置き換える時に書く） |
| [`docs/architecture.md`](../../architecture.md) | conductor が将来 symphony を置き換えることを 1 段落で追記、`agent.type: mock` の存在も contributor 注として追記 |
| [`docs/protocol.md`](../../protocol.md) | 更新不要（プロトコル自体は変わらない） |
| `apps/conductor/CLAUDE.md` | **新規作成**。Phase 1 の責務と完了条件、symphony との関係、kamae 準拠の指針 |
| `apps/conductor/README.md` | **新規作成**。最小限の使い方（インストール / 起動 / 開発）のみ。`agent.type: mock` は載せない |
| [`TODO.md`](../../../TODO.md) Milestone 3 Phase 1 | 進捗チェックボックスを実装フェーズで update |

---

## 作業順序（インフラファースト → bottom-up）

1. `tsconfig.base.json` 新設、`apps/claude-app-server/tsconfig.json` と `apps/e2e/tsconfig.json` を extends 化
2. `apps/conductor/` 雛形（package.json / tsconfig / vitest.config / `src/bin.ts` スケルトン / `src/cli/run.ts` の空実装）
3. `pnpm-workspace.yaml` 登録、`pnpm dev:install` 拡張
4. `apps/e2e/lib/common.ts` の `resolveBackendCommand` 導入と claude-linear.ts / claude-github.ts の差し替え（挙動不変を保つ）
5. `domain/` の型定義 + in-source test
6. `config/schema.ts` で全 schema + in-source test
7. `config/loader.ts` + `config/parser.ts` + in-source test
8. `util/redact.ts` + in-source test
9. `tracker/types.ts` + `tracker/memory.ts` + in-source test
10. `backend/types.ts` + `backend/mock.ts` + in-source test
11. `orchestrator/agent-runner.ts` + in-source test
12. `orchestrator/orchestrator.ts` + in-source test
13. `cli/run.ts` の本実装 + `util/logger.ts`
14. `examples/workflow.mock-memory.md` 追加
15. `test/integration/mock-memory-happy-path.test.ts`
16. `test/e2e/conductor-cli.test.ts`
17. `apps/conductor/CLAUDE.md` / `apps/conductor/README.md` 新規作成
18. ルート `CLAUDE.md` / `docs/architecture.md` の追記
19. `TODO.md` Phase 1 チェックボックス update

---

## リスクと緩和策

| リスク | 影響 | 緩和策 |
|---|---|---|
| `tsconfig.base.json` 統一で claude-app-server の既存ビルドが壊れる | Phase 1 で既存緑が割れる | base.json は既存 claude-app-server tsconfig の compilerOptions と互換になるよう確認、PR 提出前に `pnpm --filter claude-app-server build` と `pnpm test` を回す |
| in-source test の `import.meta.vitest` が本番 build に残る | dist サイズ膨張 or 実行時 undefined ref | `vitest.config.ts` の `define` で `"import.meta.vitest": "undefined"` を設定し、`tsc --build` 後の `dist/` を grep で確認 |
| `agent.type: mock` が contributor 向けと README で混同される | 一般ユーザに見えてしまう | README には載せず、CLAUDE.md / `docs/architecture.md` の contributor 注として明記。Phase 1 PR レビューで確認 |
| `apps/e2e/lib/common.ts` リファクタで `pnpm test:e2e` が回帰する | Phase 3-4 まで影響 | リファクタ後に `pnpm test:e2e:claude-linear` を 1 回手動で回して symphony 経由緑を再確認 |
| 全 schema を Phase 1 で書くと Linear / GitHub の細部で時間を取られる | Phase 1 が肥大化 | schema は「shape の宣言と必須/任意の区別のみ」に留め、各 field の細かい正規化は使う Phase で追加。Phase 1 では schema 違反の検出ができれば十分 |

---

## 参考資料

- 親 spec [`2026-05-15-m3-overview-design.md`](2026-05-15-m3-overview-design.md)
- [`TODO.md`](../../../TODO.md) Milestone 3 Phase 1
- ルート [`CLAUDE.md`](../../../CLAUDE.md)
- [`apps/symphony/CLAUDE.md`](../../../apps/symphony/CLAUDE.md)
- [`apps/claude-app-server/CLAUDE.md`](../../../apps/claude-app-server/CLAUDE.md)
- [`docs/architecture.md`](../../architecture.md)
- [`docs/protocol.md`](../../protocol.md)
- [ADR-0004 agent.type backend selection](../../adr/0004-agent-type-backend-selection.md)
- [ADR-0008 symphony → conductor migration](../../adr/0008-symphony-to-conductor-migration.md)
- [ADR-0013 tracker block split by kind](../../adr/0013-tracker-block-split-by-kind.md)
- [ADR-0014 Symphony owned state transitions](../../adr/0014-symphony-owned-state-transitions.md)
- 移植元: [`apps/symphony/lib/symphony_elixir/tracker/memory.ex`](../../../apps/symphony/lib/symphony_elixir/tracker/memory.ex)
