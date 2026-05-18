# Milestone 3 Phase 3: Linear tracker + 自動 state 遷移 + Linear E2E — 設計書

**日付:** 2026-05-16
**対象:** [`TODO.md`](../../../TODO.md) M3 Phase 3
**前提 spec:** [M3 overview](2026-05-15-m3-overview-design.md) / [M3 Phase 1](2026-05-16-m3-phase1-design.md) / [M3 Phase 2](2026-05-16-m3-phase2-design.md)
**根拠 ADR:** [ADR-0013 tracker block split](../../adr/0013-tracker-block-split-by-kind.md) / [ADR-0014 Symphony-owned state transitions](../../adr/0014-symphony-owned-state-transitions.md)
**ステータス:** 設計確定、実装着手待ち

---

## 背景

Phase 1 で Memory tracker + Mock backend、Phase 2 で実 backend subprocess + workspace + 実 claude-app-server / codex の E2E が完了している。Phase 3 では **Linear tracker** を実装し、`apps/symphony` と同じ Linear ワークフローを `apps/conductor` 単独で動かせるようにする。同時に、`pnpm test:e2e:claude-linear` の起動コマンドを conductor に切り替える (symphony 経路は env var で残す)。

ADR-0014 で確定した **Symphony 主導の state transition** (`doing_state` / `done_state` を orchestrator から直接 mutate、3 試行 retry の best-effort) を Conductor に移植する。symphony 旧経路 (LLM が `linear_graphql` curl を叩く) は本 Phase で **撤去**し、Conductor 主導に統一する。

---

## スコープ

### In scope

- Linear GraphQL クライアント (自前 fetch + valibot、共通関数化)
- Linear Tracker adapter (`Tracker` interface 5 callback を実装)
- `doing_state` / `done_state` mutation: tracker 内部で 3 試行 retry (250ms / 1s backoff)、3 連続失敗は warn log のみで `ok(undefined)` 返す best-effort 動作 (ADR-0014 忠実)
- `assignee` filter: GraphQL クエリレベルで適用。`"me"` 指定時のみ `viewer { id }` で id 解決 (lazy + memoize)
- WORKFLOW.md `linear:` ブロックの `$LINEAR_API_KEY` 形式 env var 展開 (config layer)
- `LinearClientError` / `TrackerError` 拡張、CLI の error formatter 拡張
- `apps/conductor/examples/workflow.claude-linear.md` 新規 (conductor 単体起動の reference、placeholder 値)
- `apps/e2e/workflow.claude-linear.md` 更新 (curl 手順を削除、`doing_state`/`done_state` を追加)
- `apps/e2e/lib/common.ts` の `resolveBackendCommand` を env var (`CONCERT_E2E_BACKEND`) で symphony / conductor を選択可に変更。デフォは conductor
- `pnpm test:e2e:claude-linear` のデフォ起動を conductor に切替
- Integration テスト (`apps/conductor/test/integration/tracker-linear-flow.test.ts` 新規) + in-source unit テスト一式

### Out of scope (Phase 6 以降に送る)

- Issue domain model の拡張 (priority / createdAt / branchName / url / labels / assigneeId / blockedBy 等)
- priority sort, `assigned_to_worker` check, blocker (`blocked_by`) による skip — orchestrator の candidate filter ロジック側
- `createComment` の prompt template からの利用 (interface 上には実装するが現状 orchestrator から呼ばれない)
- GitHub tracker (Phase 4)
- ProjectMeta cache 機構 (Phase 4 で GitHub Projects v2 用に作る)

### 成功基準

1. `pnpm --filter conductor test` 全件緑 (Phase 2 既存 + Phase 3 新規)
2. `pnpm --filter conductor build` 成功
3. `pnpm test:e2e:claude-linear` (デフォ = conductor) で CYFY-5 が `Todo → In Progress → Done` に遷移して PASS
4. `CONCERT_E2E_BACKEND=symphony pnpm test:e2e:claude-linear` でも CYFY-5 が PASS (curl 手順削除した workflow.md で symphony が ADR-0014 経路で動く)
5. 起動時 config dump で `api_key` が `*****` で出る (既存 `redactConfig` の動作確認)

---

## アーキテクチャ

```
apps/conductor/
├── src/
│   ├── tracker/
│   │   ├── types.ts             # 既存 (Tracker interface、変更なし)
│   │   ├── memory.ts            # 既存
│   │   ├── factory.ts           # ★ 新規: 同期 (memory) / async (linear) を吸収
│   │   └── linear/              # ★ 新規
│   │       ├── client.ts        # linearGraphqlRequest (private) + linearQuery / linearMutation (export)
│   │       ├── queries.ts       # GraphQL クエリ文字列 + 各 response の valibot schema
│   │       └── adapter.ts       # createLinearTracker(config, deps) — Tracker 実装 + retry helper
│   ├── config/
│   │   ├── env-resolve.ts       # ★ 新規: $VAR_NAME → process.env.VAR_NAME
│   │   └── schema.ts            # ★ 修正: buildTracker の linear 分岐で env 展開
│   ├── domain/
│   │   └── errors.ts            # ★ 修正: TrackerError に Linear 系 variant を追加
│   ├── orchestrator/
│   │   └── orchestrator.ts      # ★ Logger interface に warn を追加
│   ├── util/
│   │   ├── logger.ts            # ★ createStdLogger に warn 実装
│   │   └── redact.ts            # 変更なし
│   └── cli/
│       └── run.ts               # ★ Phase 2 の memory ガード削除、createTracker(...) を await、formatTrackerError 拡張
├── examples/
│   └── workflow.claude-linear.md  # ★ 新規 (curl 手順なし、doing/done_state 付き、placeholder)
└── test/
    └── integration/
        └── tracker-linear-flow.test.ts  # ★ 新規 (fetch DI シナリオ)

apps/e2e/
├── lib/common.ts               # ★ resolveBackendCommand を env var ベース化
└── workflow.claude-linear.md   # ★ curl 手順削除、doing_state/done_state 追加
```

### コンポーネント間の関係

```
[CLI run.ts]
   ↓ createTracker(config.tracker, { logger })
[tracker/factory.ts]
   ↓ kind=linear
[createLinearTracker]
   ↓ resolveAssigneeFilter (viewer query 1 回)
   ↓ 5 callback を実装した Tracker を返す
[Tracker]
   ↓ fetchCandidateIssues / fetchIssuesByStates / fetchIssueStatesByIds / createComment / updateIssueState
[linearQuery / linearMutation]
   ↓ linearGraphqlRequest (HTTP boundary)
[fetch]
```

---

## §3 Linear GraphQL クライアント (`src/tracker/linear/`)

### `client.ts` — HTTP boundary

`linearGraphqlRequest` (private) が唯一の HTTP layer。query/mutation 共通で使う。呼び出し側の意図を明示するため `linearQuery` / `linearMutation` の薄い wrapper を export する。

```ts
export const DEFAULT_LINEAR_ENDPOINT = "https://api.linear.app/graphql";

export type LinearClientDeps = Readonly<{
  endpoint: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;  // test DI
  timeoutMs?: number;               // default 30_000
}>;

// HTTP layer から返るエラー (TrackerError の Linear 系 variant の subset、同名で揃える)
export type LinearClientError = Extract<
  TrackerError,
  { kind: "linear-http" | "linear-graphql-errors" | "linear-response-invalid" | "linear-network" }
>;

const linearGraphqlRequest = async <T>(
  deps: LinearClientDeps,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, T>,
): Promise<Result.Result<T, LinearClientError>> => { /* ... */ };

export const linearQuery = <T>(
  deps: LinearClientDeps,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, T>,
) => linearGraphqlRequest(deps, query, variables, schema);

export const linearMutation = linearQuery;  // 実装は共通、シグネチャだけ別名
```

**HTTP layer の責務:**
- `POST endpoint` + `Authorization: <apiKey>` (Linear は `Bearer` なし) + `Content-Type: application/json`
- `AbortSignal` で `timeoutMs` (default 30s) を効かせる
- HTTP status != 200 → `linear-http` (body は ~1000 bytes truncate)
- `errors` envelope → `linear-graphql-errors`
- valibot 検証失敗 → `linear-response-invalid` (path 付き issues)
- fetch 例外 (network 切断) → `linear-network`
- error の中身に **api_key 値を含めない** (Authorization ヘッダや変数値を error.body に乗せないこと)

### `queries.ts` — Query 文字列 + Response schema

定義する query / mutation:

1. `LIST_ISSUES_QUERY` — pagination 付き、`assignee` filter を variable で受け取る。fetch field: `id`/`identifier`/`title`/`description`/`state{name}` + `pageInfo { hasNextPage endCursor }`
2. `LIST_ISSUES_BY_IDS_QUERY` — `filter: { id: { in: $ids } }`、page size = ids 長
3. `VIEWER_QUERY` — `viewer { id }` (`assignee="me"` 解決用)
4. `RESOLVE_STATE_ID_QUERY` — `issue(id) { team { states(filter: { name: { eq } }) { nodes { id } } } }`
5. `UPDATE_STATE_MUTATION` — `issueUpdate(id, input: { stateId }) { success }`
6. `CREATE_COMMENT_MUTATION` — `commentCreate(input: { issueId, body }) { success }`

valibot response schema は各 query ごとに併置。`description` は `v.nullable(v.string())` (Linear API は null を返しうる)。

---

## §4 Linear Adapter (`adapter.ts`)

```ts
export const createLinearTracker = async (
  config: LinearTrackerConfig,
  deps: { logger: Logger; fetch?: typeof globalThis.fetch },
): Promise<Result.Result<Tracker, TrackerError>> => { /* ... */ };
```

### 5 callback の中身

1. **`fetchCandidateIssues`** — `config.activeStates` を `LIST_ISSUES_QUERY` に渡す。空配列なら `ok([])` で即返し。pagination ループ (page size 50) で全 page を集める
2. **`fetchIssuesByStates(states)`** — 同上、states を引数の値で
3. **`fetchIssueStatesByIds(ids)`** — ids を 50 件ずつ batch 分割 → `LIST_ISSUES_BY_IDS_QUERY` を順に叩く → requested ids 順に sort して返す (symphony の `sort_issues_by_requested_ids` 互換)
4. **`createComment(issueId, body)`** — `CREATE_COMMENT_MUTATION` を `linearMutation` で叩く。`success: false` なら `linear-graphql-errors` 相当の Failure を返す
5. **`updateIssueState(issue, stateName)`** — 後述の retry helper 経由

### assignee 解決

```ts
type AssigneeFilter =
  | { kind: "none" }
  | { kind: "id"; id: string };

const resolveAssigneeFilter = async (
  clientDeps: LinearClientDeps,
  assignee: string | undefined,
): Promise<Result.Result<AssigneeFilter, LinearClientError>> => {
  if (!assignee) return ok({ kind: "none" });
  if (assignee.trim() === "me") {
    // viewer { id } を叩いて id を解決
  }
  return ok({ kind: "id", id: assignee.trim() });
};
```

`createLinearTracker` 内で **1 度だけ** 解決し、5 callback が共有する。viewer query が必要なのは `assignee="me"` のときのみ — `assignee` 未設定なら fetch を呼ばないこと (unit test で assert)。

### retry helper (ADR-0014 忠実)

```ts
const RETRY_DELAYS_MS = [250, 1000] as const;  // 3 試行 = initial + 2 retry

const updateStateWithRetry = async (
  clientDeps: LinearClientDeps,
  logger: Logger,
  issue: Issue,
  stateName: IssueStateName,
): Promise<Result.Result<void, TrackerError>> => {
  const stateIdR = await resolveStateId(clientDeps, issue.id, stateName);
  if (stateIdR.type === "Failure") return stateIdR;   // 設定ミス、retry しない

  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await doUpdateState(clientDeps, issue.id, stateIdR.value);
    if (r.type === "Success") return r;
    if (attempt < RETRY_DELAYS_MS.length) {
      logger.info(`[linear] updateIssueState retry ${attempt + 1}/3 after ${RETRY_DELAYS_MS[attempt]}ms (issue=${issue.identifier})`);
      await delay(RETRY_DELAYS_MS[attempt]);
    }
  }
  logger.warn(`[linear] updateIssueState failed after 3 attempts (issue=${issue.identifier}); continuing best-effort per ADR-0014`);
  return ok(undefined);
};
```

**ポイント:**
- `resolveStateId` は **retry 外**。state name → id 解決失敗 = 設定ミス (team に該当 state がない) なので即 `linear-state-not-found` で Failure
- `doUpdateState` 内の `linearMutation` 呼び出しのみ retry 対象
- `success: false` レスポンスも Failure として扱い retry 対象に含める
- 3 連続失敗 → `ok(undefined)` + warn log で best-effort 継続 (agent-runner は failure 扱いしない)

### Linear → Conductor Issue 変換

GraphQL response の `nodes[i]` を Issue に詰める:
- `description: null → ""` に正規化
- `id` / `identifier` / `state.name` は `v.parse(IssueId.schema, ...)` / 等で branding
- 拡張 field (priority/createdAt/.../assigneeId) は **Issue 型に乗せない** (Phase 6 で sort/filter 機能と一緒に追加)

---

## §5 Config 拡張 (env var 展開 + redact)

### `src/config/env-resolve.ts` (新規)

```ts
const ENV_REF_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

export type EnvResolveError =
  | { kind: "missing-env"; var: string }
  | { kind: "empty-env"; var: string };

export const resolveEnvRef = (
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): Result.Result<string, EnvResolveError> => { /* ... */ };
```

**仕様 (symphony 互換):**
- `$LINEAR_API_KEY` 形式のみ展開 (`${VAR}` や `$VAR-suffix` は対象外、`as-is` で返す)
- 値が `undefined` → `missing-env`
- 値が空文字 → `empty-env`
- 上記以外 (literal 文字列) はそのまま返す

### `src/config/schema.ts` の `buildTracker` linear 分岐修正

`yaml.linear.api_key` と `yaml.linear.assignee` を `resolveEnvRef` に通してから `LinearTrackerConfig` に詰める。失敗時は `throw new Error(...)` で invariant-violation 経路に乗せる (既存 invariant 流儀)。

### `src/util/redact.ts`

変更なし。既存の `redactConfig` が `tracker.kind === "linear"` の `apiKey` を MASK 化するので CLI 起動時の effective config dump はそれを通せばよい。

HTTP layer 側で **api_key 値を error/log に絶対に出さない責務**を内蔵することで、ランタイムの redaction も担保する。

---

## §6 Orchestrator / CLI 既存箇所の修正

### `src/tracker/factory.ts` (新規)

```ts
export const createTracker = async (
  config: TrackerConfig,
  deps: { logger: Logger; fetch?: typeof globalThis.fetch },
): Promise<Result.Result<Tracker, TrackerError>> => {
  switch (config.kind) {
    case "memory": return ok(createMemoryTracker(config));
    case "linear": return await createLinearTracker(config, deps);
    case "github": return fail({ kind: "unsupported-tracker-kind", kind_: "github" });
  }
};
```

### `src/cli/run.ts` 修正

- L111 の `if (config.tracker.kind !== "memory")` Phase 2 ガード削除
- `const tracker = createMemoryTracker(config.tracker);` を `const trackerR = await createTracker(config.tracker, { logger }); if (trackerR.type === "Failure") { ... process.exit(1); } const tracker = trackerR.value;` に置換
- `formatTrackerError(err: TrackerError): string` を切り出し、各 Linear variant を見やすく整形
- `formatOrchestratorError` の `tracker` 分岐がこれを経由

### `src/orchestrator/orchestrator.ts` の `Logger` interface 拡張

```ts
export type Logger = Readonly<{
  info(msg: string): void;
  warn(msg: string): void;   // ★ 追加
  error(err: unknown): void;
}>;
```

### `src/util/logger.ts` の `createStdLogger`

`warn(msg) => console.warn(msg)` を 1 行追加。

### `src/domain/errors.ts` の `TrackerError` 拡張

```ts
export type TrackerError =
  | { kind: "unknown-state"; state: string }
  | { kind: "issue-not-found"; id: string }
  | { kind: "linear-http"; status: number; bodyExcerpt: string }
  | { kind: "linear-graphql-errors"; messages: ReadonlyArray<string> }
  | { kind: "linear-response-invalid"; issues: ReadonlyArray<string> }
  | { kind: "linear-network"; cause: string }
  | { kind: "linear-state-not-found"; stateName: string }
  | { kind: "linear-config"; cause: string }     // runtime config 不整合 (例: viewer 解決失敗)
  | { kind: "unsupported-tracker-kind"; kind_: string };  // factory が未実装 kind を受けたとき
```

### 変更しないもの

- `orchestrator.ts` 本体ロジック (tracker 経由 mutation の API shape が `Result.Result<void, TrackerError>` のまま、retry が adapter 内に閉じてる)
- `agent-runner.ts` 本体ロジック (best-effort で `ok(undefined)` が返るので mutation 失敗時の挙動は変わる必要なし)

### 既存テストへの diff

`orchestrator.ts` / `agent-runner.ts` の in-source test 内に 4 箇所程度ある Logger literal (`{ info: () => {}, error: () => {} }`) に `warn: () => {}` を追加。

---

## §7 E2E 切替 + `workflow.claude-linear.md` 整理

### `apps/e2e/lib/common.ts` の `resolveBackendCommand` 修正

```ts
const VALID_BACKENDS = ["symphony", "conductor"] as const;
type BackendChoice = (typeof VALID_BACKENDS)[number];

const readBackendChoice = (env = process.env): BackendChoice => {
  const raw = env.CONCERT_E2E_BACKEND?.trim();
  if (!raw) return "conductor";  // Phase 3 default
  if ((VALID_BACKENDS as readonly string[]).includes(raw)) return raw as BackendChoice;
  throw new Error(`Invalid CONCERT_E2E_BACKEND=${raw}; must be one of ${VALID_BACKENDS.join(",")}`);
};

export const resolveBackendCommand = (): BackendCommand => {
  switch (readBackendChoice()) {
    case "symphony":
      return {
        cmd: "./bin/symphony",
        args: ["--i-understand-that-this-will-be-running-without-the-usual-guardrails"],
        cwd: path.join(REPO_ROOT, "apps/symphony"),
      };
    case "conductor":
      return {
        cmd: "conductor",
        args: ["--i-understand-that-this-will-be-running-without-the-usual-guardrails"],
      };
  }
};
```

callsite (`apps/e2e/claude-linear.ts:357`、`apps/e2e/claude-github.ts` 内の対応箇所) を `resolveBackendCommand()` (no arg) に修正。

### `workflow.claude-linear.md` 配置

| ファイル | 目的 | 内容 |
|---|---|---|
| `apps/e2e/workflow.claude-linear.md` | repo-wide E2E (`pnpm test:e2e:claude-linear`) で実 Linear と疎通 | `project_slug: concert-3f96fb9d18cf`、`workspace.root: /tmp/concert-e2e/workspaces`、curl 削除、`doing_state: "In Progress"` / `done_state: "Done"` 追加 |
| `apps/conductor/examples/workflow.claude-linear.md` (新規) | conductor 単体起動の reference (README リンク用、ユーザが書き換える叩き台) | placeholder 値 (`project_slug: your-project-slug-here` / `workspace.root: /tmp/conductor/workspaces`)、コメントで設定方法 |
| Linear adapter integration test (`apps/conductor/test/integration/tracker-linear-flow.test.ts`) | mock fetch を DI して GraphQL 応答パターンを網羅 | YAML を読まず Linear adapter を直接呼ぶ |

### Phase 3 完了時の互換性

Symphony 経路 (`CONCERT_E2E_BACKEND=symphony`) でも `apps/e2e/workflow.claude-linear.md` を読む。symphony は M2 Phase 3 で `doing_state`/`done_state` 対応済 (ADR-0014)、curl 手順なしでも動く。Phase 3 着手早期に手動で 1 度動作確認する。

---

## §8 テスト戦略

### Unit tests (in-source `import.meta.vitest`)

| 対象 | テスト内容 |
|---|---|
| `config/env-resolve.ts` | `$VAR` 展開成功 / 未参照文字列はそのまま / `missing-env` / `empty-env` / 不正な ref (`$1FOO`) はそのまま |
| `config/schema.ts` (linear 分岐) | `api_key: $LINEAR_API_KEY` が env から解決される / env 未設定で invariant-violation / `assignee: $LINEAR_ASSIGNEE` も同様 / project_slug は env 展開なしの literal |
| `tracker/linear/client.ts` | fetch DI: 200 / 401 → `linear-http` / `errors` envelope → `linear-graphql-errors` / schema mismatch → `linear-response-invalid` / fetch throw → `linear-network` / timeout (`AbortSignal`) |
| `tracker/linear/queries.ts` | valibot schema が想定 response shape を accept、`description: null` を accept |
| `tracker/linear/adapter.ts` (callback) | (1) `resolveAssigneeFilter` の "me" / 直 id / undefined 分岐 (2) viewer query を **1 度だけ叩く** + assignee 未設定なら呼ばない (3) pagination (mock fetch が 2 page を返す → 1 配列にフラット化) (4) `fetchIssueStatesByIds` の id 順保持 (5) `createComment` の `success: false` → `linear-graphql-errors` |
| `tracker/linear/adapter.ts` (retry) | `vi.useFakeTimers()` で: 1 回目失敗 / 2 回目成功 → ok (250ms 進めて呼び出し 2 回) / 3 連続失敗 → `ok(undefined)` + warn log spy 検証 / `resolveStateId` 失敗は retry されず即 Failure |
| `tracker/factory.ts` | memory / linear 分岐の Result 返却 |
| `cli/run.ts` の `formatTrackerError` | 各 Linear variant が human-readable に整形 |

### Integration test (`apps/conductor/test/integration/tracker-linear-flow.test.ts` 新規)

- `createLinearTracker(config, { logger, fetch: spyFetch })` で fetch を直接 DI
- シナリオ:
  1. viewer query 1 回 (assignee="me" の場合)
  2. `fetchCandidateIssues` で issues 2 件 (1 page 完結) を返す
  3. `updateIssueState(issue, "Done")` で state id 解決 → `issueUpdate { success: true }`
  4. 別 issue で `updateIssueState` を呼び 3 回連続 500 → `ok(undefined)` + warn 発火
- spyFetch の call sequence と request body を assert

### E2E test

- **`apps/conductor/test/e2e/` には Linear E2E を置かない**。実 API トークン依存は repo-wide E2E に集約
- 既存 `conductor-claude-memory.test.ts` / `conductor-codex-memory.test.ts` は不変

### Repo-wide E2E (`apps/e2e/claude-linear.ts`)

- スクリプト本体は変更なし
- `resolveBackendCommand()` 経由でデフォ起動が conductor になる
- 動作確認手順:
  ```
  pnpm build && pnpm dev:install && pnpm --filter e2e build
  LINEAR_API_KEY=lin_xxx pnpm test:e2e:claude-linear                          # conductor
  LINEAR_API_KEY=lin_xxx CONCERT_E2E_BACKEND=symphony pnpm test:e2e:claude-linear  # 旧経路で比較
  ```

### `vitest.config.ts`

既存設定 (`include: ["test/**/*.test.ts"]`) で integration test もそのまま拾われる。設定変更なし。

---

## §9 完了判定 + リスク

### 完了判定

1. `pnpm --filter conductor test` 全件緑
2. `pnpm --filter conductor build` 成功
3. `pnpm test:e2e:claude-linear` (conductor) で CYFY-5 が `Todo → In Progress → Done` で PASS
4. `CONCERT_E2E_BACKEND=symphony pnpm test:e2e:claude-linear` でも PASS (互換性確認)
5. 起動時 config dump で `api_key` が `*****`
6. `pnpm test:e2e:claude-github` が `CONCERT_E2E_BACKEND=symphony` 指定で旧来通り symphony 経由で緑 (GitHub E2E の回帰なし)
7. TODO.md M3 Phase 3 の 5 項目すべてチェック

### リスクと緩和

| リスク | 影響 | 緩和 |
|---|---|---|
| viewer query が assignee 未設定でも呼ばれて余計な API クォータを食う | E2E rate-limit 早出し | `resolveAssigneeFilter` で `assignee === undefined` の早期 return を確実にし、unit test で spyFetch が viewer を呼んでないことを assert |
| `description: null` を受け取って valibot 検証失敗 | E2E が即時 fail | queries.ts schema に `v.nullable` を最初から入れる、unit test で `description: null` を必ず網羅 |
| `success: false` を見逃して done_state 遷移してない issue を完了とカウント | E2E 偽 PASS | adapter `updateIssueState` 内で `success !== true` を retry 対象。unit test で `success: false` を Failure として返すこと |
| retry の `vi.useFakeTimers()` が `delay()` (`setTimeout`) と組み合わせて hang | テスト timeout | retry helper の `delay` は `setTimeout` ベース、test は `vi.advanceTimersByTimeAsync(250)` で進める |
| symphony 経路で curl 削除した workflow.md が動かない | 並行モード期待が崩れる | Phase 3 着手早期に **手動で 1 回 symphony 起動** して `doing_state`/`done_state` 経由で動くか確認、ダメなら workflow.md を**両者で別ファイル**にフォールバック |
| LINEAR_API_KEY が log に漏れる | secret 漏洩 | `linearGraphqlRequest` 内で error.body を 1000 bytes truncate、Authorization 値は log に絶対出さない unit test で代表ケース検証 |
| viewer 解決失敗で conductor 起動失敗時のエラーが冗長 | デバッグ困難 | `linear-config` variant の error formatter で human-readable hint ("LINEAR_API_KEY が無効、または Linear API が応答していません" 等) を出す |
| Logger.warn 追加で他テストが TS エラー | ビルド失敗 | 既存 `silent`/`logger` literal 4 箇所に `warn: () => {}` を追加 (実装プランに diff として記載) |

---

## 参考資料

- ルート [`CLAUDE.md`](../../../CLAUDE.md)
- [M3 overview spec](2026-05-15-m3-overview-design.md)
- [M3 Phase 1 spec](2026-05-16-m3-phase1-design.md)
- [M3 Phase 2 spec](2026-05-16-m3-phase2-design.md)
- [ADR-0013 tracker block split by kind](../../adr/0013-tracker-block-split-by-kind.md)
- [ADR-0014 Symphony-owned state transitions](../../adr/0014-symphony-owned-state-transitions.md)
- 移植元 symphony Linear client: [`apps/symphony/lib/symphony_elixir/linear/client.ex`](../../../apps/symphony/lib/symphony_elixir/linear/client.ex)
- 移植元 symphony Linear adapter: [`apps/symphony/lib/symphony_elixir/linear/adapter.ex`](../../../apps/symphony/lib/symphony_elixir/linear/adapter.ex)
- 既存 E2E Linear クライアント (参考): [`apps/e2e/claude-linear.ts`](../../../apps/e2e/claude-linear.ts)
