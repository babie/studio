# `apps/perform` 実装指示書

## あなたの担当

このディレクトリは studio モノレポの **orchestrator** です (TypeScript)。
当初は `apps/symphony` (Elixir) を改造する想定で、Milestone 3 で
TypeScript に書き直して現在の形になりました。Milestone 4 でリブランディングして
`apps/perform` になりました ([ADR-0017](../../docs/adr/0017-rebranding-to-studio.md))。
モノレポ全体の文脈はリポジトリルートの `CLAUDE.md` を読むこと。本ファイルは perform に
固有の事項のみ扱う。

---

## このアプリの位置づけ

- M3 で `apps/symphony/` (Elixir) からの 1:1 移植が完了 (Phase 7、2026-05-18 に
  symphony 削除済、[ADR-0015](../../docs/adr/0015-conductor-port-completion.md))
- M4 で `apps/conductor` → `apps/perform` にリブランディング済
  ([ADR-0017](../../docs/adr/0017-rebranding-to-studio.md))
- WORKFLOW.md を読み、tracker (Linear / GitHub / Memory) から issue を拾い、
  backend (claude-app-server / codex / mock) を spawn して仕事をさせる
- perform が唯一の orchestrator
- 本家 `openai/symphony` への追従は不要（個人ユースのフォーク）

---

## TS スタック

| 領域 | ライブラリ |
|---|---|
| Schema | valibot |
| Result | `@praha/byethrow` |
| CLI | commander |
| YAML | js-yaml |
| Test | vitest (in-source `import.meta.vitest` + `test/`) |
| Lint/Format | oxlint / oxfmt |

`apps/claude-app-server` と同じスタック。ルート `tsconfig.base.json` を extends。

---

## 設計指針 (kamae 準拠)

- discriminated unions + branded types (Companion Object + `v.brand()`) で domain modeling
- boundary（WORKFLOW.md ロード、tracker API、backend stdio）で valibot 検証
- 全 boundary 関数は `Result<T, E>`（byethrow）。throw は最終手段
- `linear.api_key` / `github.api_key` 等の PII は `Sensitive<T>` で wrap (boundary で auto-mask)
- **新規コードは `Result.pipe(...Result.andThen|bind|map...)` で連鎖**。手動 `if (r.type === "Failure") return r;` は新規では避ける (既存コードは漸次置換)
- 1 file = 1 module。`orchestrator.ex` (1,826 行) のような巨大ファイルは作らない

---

## ディレクトリ構成

```
apps/perform/
├── CLAUDE.md                # 本ファイル
├── README.md                # 一般ユーザ向け（agent.type: mock は載せない）
├── package.json
├── tsconfig.json            # ../../tsconfig.base.json を extends
├── vitest.config.ts         # includeSource + define で in-source test
├── src/
│   ├── bin.ts               # commander entry
│   ├── domain/              # discriminated unions / branded types
│   ├── config/              # WORKFLOW.md パーサ + valibot schema
│   ├── tracker/             # Tracker interface + adapters
│   ├── backend/             # Backend interface + Mock (Phase 1) / Real (Phase 2)
│   ├── orchestrator/        # Orchestrator ループ + AgentRunner
│   ├── cli/                 # CLI 層
│   └── util/                # logger / sensitive / assert-never / schema-issue / parse-command
├── test/
│   ├── integration/
│   └── e2e/
└── examples/
    └── workflow.mock-memory.md
```

---

## Phase 分割 (M3 = Phase 1〜7)

詳細は [`docs/superpowers/specs/2026-05-15-m3-overview-design.md`](../../docs/superpowers/specs/2026-05-15-m3-overview-design.md) と
各 Phase の spec / plan を参照。

| Phase | ゴール |
|---|---|
| 1 | TS bootstrap + Memory tracker + Mock backend で in-process happy path |
| 2 | 実 backend subprocess + Workspace 管理 |
| 3 | Linear tracker + 自動 state 遷移 + Linear E2E |
| 4 | GitHub tracker + GitHub E2E |
| 5 | TUI dashboard + observability |
| 6 | 並列実行・リトライ・edge cases パリティ |
| 7 | `apps/symphony` 削除 + ドキュメント sweep (完了 2026-05-18) |

---

## `agent.type` の許容値

- `claude` / `codex` / `mock` の 3 値
- `mock` は **開発・テスト用**。本番 WORKFLOW.md には書かない（README にも載せない）
- subprocess を起動せず in-process で即時 success / forced failure を返す

`mock:` ブロックのフィールド (contributor 向け):

```yaml
mock:
  delay_ms: 0           # optional, sleep before returning
  force_fail: true      # optional, returns BackendError instead
```

---

## 落とし穴

### claude-app-server / codex が PATH にないと Phase 2 以降で動かない

`agent.type: claude` / `codex` を選んだ場合、`command:` 内の実行ファイルが
PATH にないと spawn が失敗する。`pnpm dev:install` でリンクすること。

### Pro/Max のレート制限

`max_concurrent_agents` を増やしすぎると Claude Pro/Max ですぐ throttle される。
2〜3 を推奨。`examples/workflow.claude-*.md` に明記。

### `import.meta.vitest` の dist 残存

`vitest.config.ts` の `define: { "import.meta.vitest": "undefined" }` は
**Vitest 自身の transform** にしか効かないため、`tsc` ビルド出力の `dist/`
には `if (import.meta.vitest)` ブロックが残る。実行時に `import.meta.vitest`
は `undefined` なので分岐は走らないが、コード自体は残るので注意。dist の
完全 stripping が必要なら `tsc` を `tsdown` に置き換える等の判断が必要。

---

## 完了条件 (Phase 1)

- [x] `apps/perform/` パッケージが pnpm workspace に登録され、`pnpm dev:install` で `perform` バイナリが PATH に通る
- [x] WORKFLOW.md 全 schema (agent / claude / codex / mock / tracker / memory / linear / github / workspace) を valibot で検証可能
- [x] Memory tracker + Mock backend で 1 issue を Todo → Done に内部遷移できる
- [x] `pnpm --filter perform test` がすべて green
- [x] `pnpm test:e2e:claude-linear` / `pnpm test:e2e:claude-github` が perform 経由で緑 (Phase 3〜4 で切替済、Phase 7 で symphony 経路削除)

(Phase 2 以降は各 Phase spec / plan を参照)

---

## Phase 2 status (this branch)

- 並行モデル: **plain async + AbortController** (XState / Effect 不採用)
- JSON-RPC stdio クライアント: **perform 側に独自実装** (`backend/jsonrpc/`)、claude-app-server との共有 package は M3 完了後に判断
- SSH モード (`worker.ssh_hosts`) は **移植しない** (M4+ にも見送り、TODO.md M4+ 参照)
- `hooks` は **top-level** (Phase 1 の `workspace.hooks` 入れ子化を訂正)
- guardrail flag `--i-understand-that-this-will-be-running-without-the-usual-guardrails` を **必須化** (mock backend でも)
- Memory tracker + 実 claude-app-server で 1 issue を end-to-end 完了 (`test/e2e/perform-claude-memory.test.ts`)
- Memory tracker + 実 codex も同等の E2E (`test/e2e/perform-codex-memory.test.ts`)。`codex login` (ChatGPT サブスク device code flow) 済みなら streaming + Done まで通る
- BackendSession の 3 層化案は TODO.md M4+ メモに退避
- **Memory tracker の制約**: backend (Claude/Codex) は in-process Memory tracker を直接 mutate できないため、`workflow.{mock,claude,codex}-memory.md` では `terminal_states: [Todo]` を設定して「初期状態が terminal = 1 turn 後に Done に遷移」とする。Linear/GitHub tracker (Phase 3/4) では backend が `linear_graphql` / `github_graphql` tool で状態を更新できるので、`terminal_states: [Done]` + `doing_state: In Progress` で本来の semantics になる

---

## Phase 3 status (this branch)

- Linear tracker (`src/tracker/linear/{client,queries,adapter}.ts`) は own-fetch GraphQL + valibot validation、`linearQuery` / `linearMutation` wrapper で実装。共有 package 化は M3 完了後判断
- `assignee` 解決: `"me"` → viewer query (lazy + memoize)、literal string → user id 直書き、`undefined` → no filter (viewer query NOT 発火)
- **assignee filter 用 query を 2 本に分離**: `LIST_ISSUES_QUERY` (no assignee) と `LIST_ISSUES_BY_ASSIGNEE_QUERY` (`assigneeId: ID!`)。Linear の `{ id: { eq: null } }` が「unassigned」になる罠を回避
- ADR-0014 retry: `updateIssueState` 3 attempts (250ms / 1s)、3-fail-fallback で `ok(undefined)` + `logger.warn`。agent-runner は success として扱う → LLM の作業を保護
- **agent-runner に ADR-0014 第 3 条件を追加** (`!activeStates.includes(refreshed.state)`)。`doing_state` を設定すると orchestrator が状態遷移を所有 → LLM が curl で状態を動かす旧経路は不要。Linear 用 workflow.md から curl 手順を削除済
- `tracker/factory.ts` は `memory` (sync) / `linear` (async via `createLinearTracker`) / `github` (`unsupported-tracker-kind`、Phase 4) を dispatch
- `Logger` interface に `warn(msg)` を追加。`createStdLogger` は `[warn]` 接頭辞で stderr に書く
- env var 展開: `linear.api_key: $LINEAR_API_KEY` 形式 (`config/env-resolve.ts`)
- E2E: `apps/e2e/lib/common.ts` の `resolveBackendCommand` は perform 固定 (Phase 7 で symphony 分岐削除)
- E2E に「child exit(0) + 最終ステータス terminal なら success」フォールバックを追加。perform が one-shot (issues 処理後 exit) のため
- `apps/perform/examples/workflow.claude-linear.md` は placeholder 値で users 向けに同梱。E2E 用 fixture は `apps/e2e/workflow.claude-linear.md` 側 (CYFY-5 ハードコード)
- Issue domain model **拡張なし** (Phase 3 スコープ外)。priority sort / blocker skip / assigned_to_worker check は Phase 6 で実装する

---

## Phase 4 status (this branch)

- GitHub Projects (v2) tracker (`src/tracker/github/{client,queries,project-meta,adapter}.ts`) は own-fetch GraphQL + valibot validation、`githubQuery` / `githubMutation` wrapper で実装。共有 package 化は M3 完了後判断
- ProjectMeta warmup: user scope → org scope fallback、Status SingleSelect field 抽出、option name→id Map 構築、`active_states` / `terminal_states` / `doing_state` / `done_state` の全名が options に存在することを起動時に検証
- viewer.login も warmup で fetch (assignee="me" 解決 + 将来の branch_name 用)
- Issue domain に optional `extra?: IssueExtra` を追加 (`src/domain/issue-extra.ts`)。GitHub adapter のみ `{ kind: "github", projectId, projectItemId }` を populate。Linear / Memory は undefined のまま
- `updateIssueState` は Linear と同型の 3 試行 retry (250ms / 1s)、3-fail-fallback で `ok(undefined)` + `logger.warn`。`issue.extra` 不在は `github-no-project-item` で即 Failure、option 名不在は `github-status-option-not-found` で即 Failure (どちらも retry されない)
- assignee 解決: `undefined` / `""` → none、`"me"` → warmup の `viewerLogin` を再利用 (追加 API call なし)、その他 → literal login。`fetchCandidateIssues` のみで適用、`fetchIssuesByStates` は assignee filter を適用しない (symphony との挙動互換を維持)
- pagination: project items を 50 件ずつ全 page 取得 → client-side で `__typename === "Issue"` + state ∈ activeStates + assignee 一致を filter
- `fetchIssueStatesByIds`: `nodes(ids:)` で 50 ids ずつ batch → 各 issue の `projectItems` から `project.id === meta.projectId` のものを選んで状態抽出 → 要求 id 順で sort
- env var 展開: `github.api_key: $GITHUB_TOKEN` / `github.assignee: $GITHUB_ASSIGNEE` 形式 (`config/env-resolve.ts`、Phase 3 と共有)
- E2E: `apps/e2e/workflow.claude-github.md` に `api_key: $GITHUB_TOKEN` 行を追加。`apps/e2e/lib/common.ts` の `resolveBackendCommand` は perform 固定 (Phase 7 で symphony 分岐削除)
- `apps/perform/examples/workflow.claude-github.md` は placeholder 値で users 向けに同梱。E2E 用 fixture は `apps/e2e/workflow.claude-github.md` 側 (babie/studio#1 ハードコード)
- Issue domain 拡張 (priority / branchName / url / labels / assigneeId 等) は **Phase 6 送り** (Phase 4 では `extra` 以外は触らない)

---

## Phase 5 status (this branch)

- TUI dashboard implemented under `src/observability/` (state holder, event bus, dashboard driver, ANSI renderers). Originally byte-for-byte parity with symphony `status_dashboard.ex` during the migration window (Phase 5-6); Phase 7 dropped the parity test suite when symphony was deleted
- Token usage from codex `turn/completed.usage`; claude-app-server tokens stay 0 until M4+ streaming. Mapping lives in `state.ts` (`onTurnEvent` for `kind: "turn-completed"`) + `backend/jsonrpc/messages.ts` (`extractCodexUsage`)
- Dashboard toggle: `--no-dashboard` CLI flag, `PERFORM_DEBUG=1` env, `observability.dashboard_enabled: false` in WORKFLOW.md, or non-TTY stdout — any one disables it. When disabled, stderr logger is restored
- Phase 5 goldens (formerly under `test/fixtures/dashboard/`) and the capture script were deleted in Phase 7. TUI regression detection via vitest auto-snapshot is tracked as a M4+ candidate in [`TODO.md`](../../TODO.md)
- Dashboard title was originally "SYMPHONY STATUS" (mirroring symphony's status_dashboard.ex). Renamed to "CONDUCTOR STATUS" in Phase 7, then to "PERFORM STATUS" in M4 rebranding.
- E2E (`pnpm test:e2e:claude-linear` / `:claude-github`) automatically passes `--no-dashboard` via `apps/e2e/lib/common.ts`
- `pnpm --filter perform run diff-dashboard` runs the dev-only diff vs golden (verifies byte parity locally). Not in CI

---

## Phase 6 status (this branch)

- Scheduler (`src/orchestrator/scheduler.ts`) replaces the sequential `for` loop in `orchestrator.ts`. Owns `running` Map, `claimed` Set, `retryAttempts` Map, and a `p-queue` (concurrency = `agent.max_concurrent_agents`). Tick interval = `polling.interval_ms` (default 5_000)
- **Retry policy** (symphony verbatim): continuation_retry 1s on normal exit; failure_retry `10s × 2^min(attempt-1, 10)` capped at `agent.max_retry_backoff_ms` (default 300_000)
- **Stall detection**: `agent.agent_session_stall_timeout_ms` (default 1_800_000 = 30 min). Stalled runners get a failure_retry restart
- **dispatch-filter** is pure: sort by priority (1-4, else 5) → createdAt asc → identifier; skips assigned_to_worker=false, blocker-non-terminal Todo, per-state limit exhausted
- **Issue domain extended** with `priority` (1-4 | null), `createdAt` (Date | null), `assigneeId` (string | null), `assignedToWorker` (bool, default true), `blockedBy` (BlockedByRef[]). Linear / GitHub / Memory adapters all populate the 5 fields. GitHub blocked_by stays `[]` (sub-issue API not in scope)
- **Tracker API timeout**: 15_000ms via `AbortController.timeout`. New `tracker-timeout` TrackerError surfaces to scheduler's failure_retry. Default was 30s → cut to symphony-effective 15s
- **Backend session** now exposes `exitPromise: Promise<{code, signal}>`. AgentRunner races `runTurn` against `exitPromise` so subprocess crashes mid-turn become `session-exited-mid-turn` Failures (2-layer guard: inner race in `JsonRpcClient.runTurn`, outer race in AgentRunner)
- **File logger**: pino + pino-roll + pino-pretty. JSON output to `logging.file.path` (absolute path required, default `process.cwd()/log/perform.log`), size-based wrap rotation (`max_size_mb: 10`, `max_files: 5`). `PERFORM_DEBUG=1` adds pino-pretty stderr. Logger is fully wired in `cli/run.ts` via `createStdLogger` / `createNoopLogger` from `util/logger.ts`
- **Mock backend**: new optional `exit_mid_turn: true` (test-only, README does NOT advertise). YAML key is `exit_mid_turn`
- **Workflow example fixes**: `workflow.{mock,claude,codex}-memory.md` were using `terminal_states: [Todo]` as a Phase 2 workaround. Phase 6 retired this — examples now use `terminal_states: [Done]` + `doing_state: "In Progress"`, the ADR-0014 standard
- AbortController-based shutdown: outer `signal` cancels everything. Per-issue AbortController is *not* introduced in Phase 6 (a follow-up for M4+); during reconcile-driven termination, the dispatch slot frees up and the AgentRunner exits naturally on its next turn

---

## 参考資料

- ルート [`CLAUDE.md`](../../CLAUDE.md)
- M3 overview [`docs/superpowers/specs/2026-05-15-m3-overview-design.md`](../../docs/superpowers/specs/2026-05-15-m3-overview-design.md)
- M3 Phase 1 spec [`docs/superpowers/specs/2026-05-16-m3-phase1-design.md`](../../docs/superpowers/specs/2026-05-16-m3-phase1-design.md)
- M3 Phase 2 spec [`docs/superpowers/specs/2026-05-16-m3-phase2-design.md`](../../docs/superpowers/specs/2026-05-16-m3-phase2-design.md)
- M3 Phase 3 spec [`docs/superpowers/specs/2026-05-16-m3-phase3-design.md`](../../docs/superpowers/specs/2026-05-16-m3-phase3-design.md)
- 並走している [`apps/claude-app-server/`](../claude-app-server/)
- [ADR-0017](../../docs/adr/0017-rebranding-to-studio.md) — M4 リブランディング
- kamae スキル `/workspace/.claude/skills/kamae/`
