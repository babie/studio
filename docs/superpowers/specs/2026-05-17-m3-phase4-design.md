# Milestone 3 Phase 4: GitHub tracker + GitHub E2E — 設計書

**日付:** 2026-05-17
**対象:** [`TODO.md`](../../../TODO.md) M3 Phase 4
**前提 spec:** [M3 overview](2026-05-15-m3-overview-design.md) / [M3 Phase 1](2026-05-16-m3-phase1-design.md) / [M3 Phase 2](2026-05-16-m3-phase2-design.md) / [M3 Phase 3](2026-05-16-m3-phase3-design.md)
**根拠 ADR:** [ADR-0013 tracker block split by kind](../../adr/0013-tracker-block-split-by-kind.md) / [ADR-0014 Symphony-owned state transitions](../../adr/0014-symphony-owned-state-transitions.md)
**ステータス:** 設計確定、実装着手待ち

---

## 背景

Phase 3 で Linear tracker + ADR-0014 retry + Linear E2E が完了し、`pnpm test:e2e:claude-linear` のデフォは conductor に切り替わった。Phase 4 では **GitHub tracker (Projects v2)** を実装し、`pnpm test:e2e:claude-github` も conductor デフォルトで緑にする。

`apps/symphony/lib/symphony_elixir/github/` (Milestone 2 で完成済の Elixir 実装) を 1:1 で TS に移植する。ProjectMeta cache、user→org fallback、Status field option 検証、`extra` 経由の project_item_id 引き回しなど symphony の挙動を踏襲。`apps/e2e/workflow.claude-github.md` 経路の互換性は env-ref 解決で両 backend で維持する。

---

## スコープ

### In scope

- GitHub GraphQL クライアント (自前 fetch + valibot、Linear と同型)
- ProjectMeta warmup (`projectId` / `statusFieldId` / `statusOptions` name→id Map / `viewerLogin` を 1 度だけ取得)
- user スコープ → org スコープ fallback (symphony 互換)
- 起動時 Status option 名検証 (`active_states` / `terminal_states` / `doing_state` / `done_state` の全名が options に存在)
- Tracker GitHub adapter (`Tracker` interface 5 callback)
- `assignee` filter (`undefined` / `"me"` / literal login)。`"me"` は warmup で取得済 `viewerLogin` で解決 (追加 API call なし)
- Pagination (project items を 50 件ずつ全 page 集めて client-side で state / assignee フィルタ)
- `updateIssueState` 3 試行 retry (250ms / 1s backoff、3 連続失敗で `ok(undefined)` + warn、ADR-0014 忠実)
- `Issue.extra?: IssueExtra` (discriminated union、現状 `github` variant のみ) を Issue domain に追加。GitHub adapter のみ populate
- WORKFLOW.md `github:` ブロックの `$GITHUB_TOKEN` 形式 env var 展開 (Phase 3 で linear に入れた `resolveEnvRef` を github にも適用)
- `TrackerError` に github-* variant 9 個追加、CLI の `formatTrackerError` 拡張
- `apps/conductor/examples/workflow.claude-github.md` 新規 (placeholder 値の reference)
- `apps/e2e/workflow.claude-github.md` 更新 (`api_key: $GITHUB_TOKEN` の 1 行追加、symphony 互換維持)
- Integration テスト (`apps/conductor/test/integration/tracker-github-flow.test.ts` 新規) + in-source unit テスト一式

### Out of scope (Phase 6 以降に送る)

- Issue domain model のフル拡張 (`priority` / `branchName` / `url` / `labels` / `assigneeId` / `createdAt` / `updatedAt`)
- priority sort, `assigned_to_worker` check, blocker (`blocked_by`) による skip
- failure comment / max_attempts retry
- PR-based 完了検知
- `github_graphql` 動的ツール (claude-app-server 側の MCP 動的ツール提供)
- GitHub App 認証 (PAT 前提)

### 成功基準

1. `pnpm --filter conductor test` 全件緑 (Phase 3 既存 + Phase 4 新規)
2. `pnpm --filter conductor build` 成功
3. `pnpm test:e2e:claude-github` (デフォ = conductor) で `babie/concert#1` が `Todo → In Progress → Done` に遷移して PASS
4. `CONCERT_E2E_BACKEND=symphony pnpm test:e2e:claude-github` でも PASS (curl 削除済みの workflow.md で symphony が ADR-0014 経路で動く既存挙動を維持)
5. `pnpm test:e2e:claude-linear` の symphony / conductor 両経路が引き続き緑 (Linear への回帰なし)
6. 起動時 config dump で `github.apiKey` が `*****`

---

## アーキテクチャ

```
apps/conductor/
├── src/
│   ├── domain/
│   │   ├── issue.ts             # ★ Issue に optional extra?: IssueExtra を追加
│   │   ├── issue-extra.ts       # ★ 新規: IssueExtra discriminated union (github variant)
│   │   └── errors.ts            # ★ TrackerError に github-* variant を 9 個追加
│   ├── config/
│   │   └── schema.ts            # ★ buildTracker github 分岐で resolveEnvRef 適用、TODO 解消
│   ├── tracker/
│   │   ├── factory.ts           # ★ github 分岐を createGithubTracker(...) に
│   │   └── github/              # ★ 新規ディレクトリ
│   │       ├── client.ts        # githubGraphqlRequest (private) + githubQuery / githubMutation (export)
│   │       ├── queries.ts       # 7 queries + valibot response schemas
│   │       ├── project-meta.ts  # warmupGithubProjectMeta (user→org fallback + 検証)
│   │       └── adapter.ts       # createGithubTracker + retry helper + toIssue
│   ├── util/
│   │   └── redact.ts            # 変更なし (既に github.apiKey をマスク)
│   └── cli/
│       └── run.ts               # ★ formatTrackerError に github-* 9 variant 追記
├── examples/
│   └── workflow.claude-github.md  # ★ 新規 (placeholder、users 向け叩き台)
└── test/
    └── integration/
        └── tracker-github-flow.test.ts  # ★ 新規 (fetch DI シナリオ)

apps/e2e/
└── workflow.claude-github.md   # ★ `api_key: $GITHUB_TOKEN` 行を追加 (symphony とも互換)
```

### コンポーネント間の関係

```
[CLI run.ts]
   ↓ createTracker(config.tracker, { logger })
[tracker/factory.ts]
   ↓ kind=github
[createGithubTracker]
   ↓ warmupGithubProjectMeta
   │  ↓ user scope → fallback to org scope → validate Status options → fetch viewer.login
   ↓ resolveAssigneeFilter (warmup の viewerLogin を再利用)
   ↓ 5 callback を実装した Tracker を返す
[Tracker]
   ↓ fetchCandidateIssues / fetchIssuesByStates / fetchIssueStatesByIds / createComment / updateIssueState
[githubQuery / githubMutation]
   ↓ githubGraphqlRequest (HTTP boundary)
[fetch]
```

---

## §3 ドメイン拡張 (`domain/issue.ts` / `domain/issue-extra.ts`)

### `issue-extra.ts` (新規)

```ts
export type IssueExtra =
  | Readonly<{ kind: "github"; projectId: string; projectItemId: string }>;
```

discriminated union を最初から導入する。将来 Linear や Memory が固有メタを持ちたくなったら variant を追加できる (が、Phase 4 時点では github 専用)。

### `issue.ts` 修正

```ts
export type Issue = Readonly<{
  id: IssueId;
  identifier: IssueIdentifier;
  title: string;
  description: string;
  state: IssueStateName;
  extra?: IssueExtra;   // ★ Phase 4: GitHub adapter が populate、他は undefined
}>;
```

**規約:**
- Memory tracker / Linear tracker は `extra` を populate しない (undefined のまま)
- GitHub adapter は **常に** populate (warmup 後の `meta.projectId` + 該当 project item id)
- `extra` が `undefined` または `kind !== "github"` の Issue に対して GitHub adapter の `updateIssueState` が呼ばれた場合は `github-no-project-item` を Failure として返す (retry なし)

---

## §4 GitHub GraphQL クライアント (`src/tracker/github/`)

### `client.ts` — HTTP boundary

Linear と同型。`githubGraphqlRequest` (private) を 1 本だけ持ち、`githubQuery` / `githubMutation` で intent 別 wrapper を export する。

```ts
export const DEFAULT_GITHUB_ENDPOINT = "https://api.github.com/graphql";

export type GithubClientDeps = Readonly<{
  endpoint: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;  // default 30_000
}>;

export type GithubClientError = Extract<
  TrackerError,
  { kind: "github-http" | "github-graphql-errors" | "github-response-invalid" | "github-network" }
>;

const githubGraphqlRequest = async <T>(
  deps: GithubClientDeps,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, T>,
): Promise<Result.Result<T, GithubClientError>> => { /* ... */ };

export const githubQuery = githubGraphqlRequest;
export const githubMutation = githubGraphqlRequest;
```

**HTTP layer の責務:**
- `POST endpoint` + `Authorization: Bearer <apiKey>` + `Content-Type: application/json` + `User-Agent: conductor`
- `AbortSignal` で `timeoutMs` (default 30s) を効かせる
- HTTP status != 200 → `github-http` (body は ~1000 bytes truncate)
- `errors` envelope → `github-graphql-errors`
- valibot 検証失敗 → `github-response-invalid` (path 付き issues)
- fetch 例外 (network 切断) → `github-network`
- error の中身に **apiKey 値を含めない** (Authorization ヘッダや変数値を error.body に乗せないこと)

### `queries.ts` — Query 文字列 + Response schema

symphony の `Queries` モジュール完全踏襲。7 個定義する:

1. `PROJECT_META_USER_QUERY` — `user(login) { projectV2(number) { id, fields(first: 50) { nodes { __typename ... on ProjectV2SingleSelectField { id name options { id name } } } } } }`
2. `PROJECT_META_ORG_QUERY` — 同上、`organization(login)` 版
3. `VIEWER_QUERY` — `viewer { login }`
4. `POLL_ITEMS_QUERY` — `node(id: $projectId) { ... on ProjectV2 { items(first: $first, after: $after) { nodes { id, content { __typename ... on Issue { id number title body url repository { nameWithOwner } assignees(first: 10) { nodes { login } } labels(first: 20) { nodes { name } } createdAt updatedAt } }, fieldValues(first: 20) { nodes { __typename ... on ProjectV2ItemFieldSingleSelectValue { field { ... on ProjectV2SingleSelectField { name } } name optionId } } } }, pageInfo { hasNextPage endCursor } } } }`
5. `ISSUES_BY_IDS_QUERY` — `nodes(ids: [ID!]!) { ... on Issue { id number title body url repository { nameWithOwner } projectItems(first: 10) { nodes { id project { id } fieldValues(first: 20) { nodes { __typename ... on ProjectV2ItemFieldSingleSelectValue { field { ... on ProjectV2SingleSelectField { name } } name } } } } } assignees(first: 10) { nodes { login } } labels(first: 20) { nodes { name } } createdAt updatedAt } }`
6. `ADD_COMMENT_MUTATION` — `addComment(input: { subjectId, body }) { clientMutationId }`
7. `UPDATE_ITEM_STATUS_MUTATION` — `updateProjectV2ItemFieldValue(input: { projectId, itemId, fieldId, value: { singleSelectOptionId: $optionId } }) { clientMutationId }`

valibot response schema は各 query ごとに併置。

- `description` (`Issue.body`) は `v.nullable(v.string())` (GitHub は null を返しうる)
- `content` は `v.nullable(...)` (DraftIssue / PullRequest や content 欠落)
- `content` の `__typename` は `"Issue"` 以外 (`PullRequest` / `DraftIssue`) も accept する union (`v.literal("Issue")` 分岐 + その他)
- `ProjectV2ItemFieldSingleSelectValue` 以外の field value 型 (`Text` / `Number` / `Date` / `Iteration` 等) も accept する union (拾わずに skip)
- `projectV2 { id }` の `user`/`organization` ノードは `v.nullable` (project が見つからない fallback 用)

### `project-meta.ts` — warmup + 検証

```ts
export type GithubProjectMeta = Readonly<{
  projectId: string;
  statusFieldId: string;
  statusOptions: ReadonlyMap<string, string>;   // option name → option id
  viewerLogin: string;
}>;

export const warmupGithubProjectMeta = async (
  clientDeps: GithubClientDeps,
  config: GithubTrackerConfig,
): Promise<Result.Result<GithubProjectMeta, TrackerError>> => { /* ... */ };
```

**手順 (symphony `ProjectMeta.warmup!/0` 互換):**

1. `PROJECT_META_USER_QUERY` を `{ owner: config.projectOwner, number: config.projectNumber }` で叩く
2. `data.user === null` または `data.user.projectV2 === null` なら `PROJECT_META_ORG_QUERY` で再試行
3. 両方 null → `github-project-not-found` ({ owner, number })
4. `project.fields.nodes` から `__typename === "ProjectV2SingleSelectField" && name === "Status"` の要素を抽出 (`"Status"` は **hardcoded**、symphony 互換) → 不在なら `github-status-field-not-found` ({ fieldName: "Status" })
5. `options` を `Map<name, id>` に変換
6. `[activeStates, terminalStates]` の全 string が Map に存在することを検証 → 不在の name があれば最初の不在で `github-status-option-not-found` ({ optionName, available: [...keys] })
7. `[doingState, doneState]` も同様 (undefined はスキップ、設定されていたら必須)
8. `VIEWER_QUERY` を叩いて `viewer.login` を取得 → 取得失敗は `github-config` ({ cause: "viewer.login 取得失敗" }) 等で透過
9. `GithubProjectMeta` を構築して `ok` 返却

**ポイント:**
- query 1 本目 (user scope) は GraphQL 仕様上 `errors` envelope を返さない (型不一致でも `data.user` が null になるだけ) ので、`errors` envelope を見たらそれを fallback 条件にしない (= そのまま Failure として透過)
- viewer 取得は **assignee 設定の有無に関わらず常に実施** (symphony 互換、warmup の 1 部)。viewer query が失敗したら warmup 全体が失敗

---

## §5 Adapter (`adapter.ts`)

```ts
export const createGithubTracker = async (
  config: GithubTrackerConfig,
  deps: { logger: Logger; fetch?: typeof globalThis.fetch },
): Promise<Result.Result<Tracker, TrackerError>> => { /* ... */ };
```

### 内部状態

`createGithubTracker` が closure で保持する:
- `clientDeps: GithubClientDeps` (endpoint / apiKey / fetch)
- `meta: GithubProjectMeta` (warmup 結果)
- `assigneeFilter: AssigneeFilter` (warmup 後の viewerLogin で解決済)

### AssigneeFilter

```ts
type AssigneeFilter =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "login"; login: string }>;
```

- `config.assignee === undefined` → `none`
- `config.assignee.trim() === ""` → `none`
- `config.assignee.trim() === "me"` → `{ kind: "login", login: meta.viewerLogin }` (warmup で取得済、追加 API call なし)
- それ以外 → `{ kind: "login", login: assignee.trim() }` (literal login)

### 5 callback

1. **`fetchCandidateIssues`** — `POLL_ITEMS_QUERY` を `pageSize=50` で pagination ループ。全 page を集めた後、client-side で **normalize 前にフィルタ**:
   - `content.__typename === "Issue"` のみ残す (`PullRequest` / `DraftIssue` / `content === null` を除外)
   - raw `fieldValues` から `extractStatusRaw` で Status 名を取り出し、`null` (Status 未設定) は除外
   - `state ∈ activeStates` でフィルタ
   - `assigneeFilter.kind === "login"` なら `first assignee.login === filter.login` でフィルタ (`none` は通過)
   - 残ったアイテムを `toIssue` で normalize (`IssueStateName.schema` は空文字 / null を拒否するので、必ず非空 state を持つアイテムだけが通る)
2. **`fetchIssuesByStates(states)`** — 同じ pagination → states でフィルタ (assignee filter は **適用しない**、symphony 互換)
3. **`fetchIssueStatesByIds(ids)`** — `ISSUES_BY_IDS_QUERY` を 50 ids ごとに batch。各 issue node の `projectItems.nodes` から `project.id === meta.projectId` のものを選んで、その `id` を `projectItemId` として `extra` に詰める。fieldValues から Status を抽出。要求 id 順で sort して返す (symphony の `sort_issues_by_requested_ids` 互換)
4. **`createComment(issueId, body)`** — `ADD_COMMENT_MUTATION` を叩く。`data.addComment` が来れば success、`errors` envelope は client.ts 内で github-graphql-errors になる
5. **`updateIssueState(issue, stateName)`** — 後述の retry helper 経由

### `toIssue` 変換

```ts
const toIssue = (
  meta: GithubProjectMeta,
  item: { id: string; content: { __typename: "Issue"; id: string; number: number; title: string; body: string | null; repository: { nameWithOwner: string } }; fieldValues: ... },
): Issue => {
  const identifier = `${item.content.repository.nameWithOwner}#${item.content.number}`;
  const state = extractStatus(item.fieldValues);  // "Status" field の single-select value name か null
  return {
    id: v.parse(IssueId.schema, item.content.id),
    identifier: v.parse(IssueIdentifier.schema, identifier),
    title: item.content.title,
    description: item.content.body ?? "",
    state: v.parse(IssueStateName.schema, state ?? ""),  // null は activeStates に含まれないので filter で抜ける
    extra: { kind: "github", projectId: meta.projectId, projectItemId: item.id },
  };
};
```

**注意:** Status が未設定 (`extractStatusRaw` が `null` を返す) の project item は **normalize 前** に filter で抜く (上記 `fetchCandidateIssues` のフィルタ手順参照)。`IssueStateName.schema` は空文字を拒否するため、`toIssue` には必ず非空 state が来る前提を保つ。`fetchIssuesByStates` も同じ前処理を経由する。

### `fetchIssueStatesByIds` の details

- `ISSUES_BY_IDS_QUERY` は `nodes(ids: [ID!]!)` を使う。返ってきた `nodes` の各要素について:
  - `null` ノードや `__typename !== "Issue"` は skip
  - `projectItems.nodes` から `project.id === meta.projectId` のものを find。**見つからなければ skip** (該当 issue は対象 project に登録されていない = 結果配列に含めない、symphony の `normalize_issue_node` 互換)
  - field values から Status を取り出して `Issue` を組み立て
- 結果は要求 id の order に従って sort

### retry helper (Linear と同型)

```ts
const RETRY_DELAYS_MS: ReadonlyArray<number> = [250, 1000];

const updateStateWithRetry = async (
  clientDeps: GithubClientDeps,
  meta: GithubProjectMeta,
  logger: Logger,
  issue: Issue,
  stateName: string,
): Promise<Result.Result<void, TrackerError>> => {
  if (issue.extra?.kind !== "github") {
    return { type: "Failure", error: { kind: "github-no-project-item", issueIdentifier: issue.identifier } };
  }
  const optionId = meta.statusOptions.get(stateName);
  if (!optionId) {
    return {
      type: "Failure",
      error: {
        kind: "github-status-option-not-found",
        optionName: stateName,
        available: [...meta.statusOptions.keys()],
      },
    };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await doUpdateItemStatus(clientDeps, {
      projectId: issue.extra.projectId,
      itemId: issue.extra.projectItemId,
      fieldId: meta.statusFieldId,
      optionId,
    });
    if (r.type === "Success") return r;
    if (attempt < RETRY_DELAYS_MS.length) {
      logger.info(
        `[github] updateIssueState retry ${attempt + 1}/3 after ${RETRY_DELAYS_MS[attempt]}ms (issue=${issue.identifier})`,
      );
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }
  logger.warn(
    `[github] updateIssueState failed after 3 attempts (issue=${issue.identifier}); continuing best-effort per ADR-0014`,
  );
  return { type: "Success", value: undefined };
};
```

**ポイント:**
- `issue.extra?.kind !== "github"` のチェックと option id 解決は retry 外 (設定ミス系は即 Failure)
- HTTP / network / transient mutation 失敗のみ retry 対象
- 3 連続失敗 → `ok(undefined)` + warn log で best-effort 継続

### `__internal__` export

Linear と同じく、隣接ファイル / テストから触りたい内部関数 (`toIssue` / `resolveAssigneeFilter` / `extractStatus` 等) は `__internal__` namespace で限定的に export する。

---

## §6 Config 拡張 (env var 展開)

### `src/config/schema.ts` の `buildTracker` github 分岐修正

既存の TODO コメントを削除し、Linear と同じ pattern で `resolveEnvRef` を適用:

```ts
case "github": {
  if (!yaml.github) {
    throw new Error("tracker.kind=github requires a `github:` block");
  }
  const apiKeyR = resolveEnvRef(yaml.github.api_key);
  if (apiKeyR.type === "Failure") {
    throw new Error(`github.api_key: ${apiKeyR.error.kind} ($${apiKeyR.error.var})`);
  }
  let assignee: string | undefined;
  if (yaml.github.assignee !== undefined) {
    const r = resolveEnvRef(yaml.github.assignee);
    if (r.type === "Failure") {
      throw new Error(`github.assignee: ${r.error.kind} ($${r.error.var})`);
    }
    assignee = r.value;
  }
  const out: GithubTrackerConfig = {
    kind: "github",
    ...common,
    apiKey: apiKeyR.value,
    ...(yaml.github.endpoint !== undefined ? { endpoint: yaml.github.endpoint } : {}),
    projectOwner: yaml.github.project_owner,
    projectNumber: yaml.github.project_number,
    ...(assignee !== undefined ? { assignee } : {}),
  };
  return out;
}
```

- `$GITHUB_TOKEN` 形式の env ref を展開
- 未設定 / 空文字なら invariant-violation
- literal value (`"me"` 等) はそのまま
- `assignee: me` は env ref ではないので literal として通過 → adapter 内で viewer.login に解決される

### `src/util/redact.ts`

**変更なし**。既存の `redactConfig` が `tracker.kind === "github"` の `apiKey` を MASK 化する。

HTTP layer 側で **apiKey 値を error/log に絶対に出さない責務**を内蔵することで、ランタイムの redaction も担保する。

---

## §7 Orchestrator / CLI 既存箇所の修正

### `src/tracker/factory.ts` 修正

```ts
import { createGithubTracker } from "./github/adapter.js";

export const createTracker = async (
  config: TrackerConfig,
  deps: { logger: Logger; fetch?: typeof globalThis.fetch },
): Promise<Result.Result<Tracker, TrackerError>> => {
  switch (config.kind) {
    case "memory": return { type: "Success", value: createMemoryTracker(config) };
    case "linear": return await createLinearTracker(config, deps);
    case "github": return await createGithubTracker(config, deps);
  }
};
```

`unsupported-tracker-kind` の Failure 経路は不要になる (が、Type 自体は将来別 kind が増える可能性のため残してよい)。

### `src/cli/run.ts` の `formatTrackerError` 拡張

9 個の github-* variant を追加:

```ts
case "github-http":
  return `GitHub HTTP ${err.status}: ${err.bodyExcerpt}`;
case "github-graphql-errors":
  return `GitHub GraphQL error(s): ${err.messages.join("; ")}`;
case "github-response-invalid":
  return `GitHub response did not match schema: ${err.issues.join("; ")}`;
case "github-network":
  return `GitHub network error: ${err.cause} (check GITHUB_TOKEN and connectivity)`;
case "github-project-not-found":
  return `GitHub project not found: owner=${err.owner} number=${err.number} (check project_owner / project_number)`;
case "github-status-field-not-found":
  return `GitHub project has no SingleSelect field named "${err.fieldName}"`;
case "github-status-option-not-found":
  return `GitHub project Status option "${err.optionName}" not found (available: ${err.available.join(", ")})`;
case "github-no-project-item":
  return `GitHub: issue ${err.issueIdentifier} has no resolved project item (was Issue.extra populated?)`;
case "github-config":
  return `GitHub config error: ${err.cause}`;
```

### 既存テストへの diff

`orchestrator.ts` / `agent-runner.ts` の in-source test 内に `tracker.kind: "github"` 経路を直接叩くケースは現状無いので、既存テストへの diff は最小 (`Logger` literal などは Phase 3 で既に `warn` 対応済)。

---

## §8 E2E 切替 + workflow.claude-github.md 整理

### `apps/e2e/lib/common.ts`

**変更なし**。Phase 3 で `resolveBackendCommand` は env var (`CONCERT_E2E_BACKEND`) ベース、default `conductor` 化済。`claude-github.ts:565` は既に `resolveBackendCommand()` を呼んでいる。

### `apps/e2e/workflow.claude-github.md` 修正

`api_key: $GITHUB_TOKEN` の 1 行を `github:` ブロック内に追加:

```yaml
github:
  api_key: $GITHUB_TOKEN
  project_owner: babie
  project_number: 3
  assignee: me
```

**互換性:**
- 旧 symphony は `api_key` が YAML に無い場合に `System.get_env("GITHUB_TOKEN")` に fallback していたが、`$GITHUB_TOKEN` を明示しても **同じ環境変数を読む** ので挙動は変わらない (`apps/symphony/lib/symphony_elixir/config/schema.ex` `resolve_secret_setting` の env ref 解決経路)
- conductor は `api_key` を必須としているので、明示が必要
- 結果として両 backend で同じ YAML を読める

### `apps/conductor/examples/workflow.claude-github.md` (新規)

`apps/conductor/examples/workflow.claude-linear.md` と同じ format で、placeholder 値 (`project_owner: your-github-owner`, `project_number: 1`, workspace.root: `/tmp/conductor/workspaces`)。コメントで `$GITHUB_TOKEN` の指定方法と classic PAT 必要性を明記。

### Phase 4 完了時の互換性

| 起動経路 | 結果 |
|---|---|
| `pnpm test:e2e:claude-github` (default conductor) | 新規実装が動く、PASS |
| `CONCERT_E2E_BACKEND=symphony pnpm test:e2e:claude-github` | symphony の既存 GitHub adapter で動く、PASS (回帰なし) |
| `pnpm test:e2e:claude-linear` (default conductor) | Phase 3 実装で動く、PASS |
| `CONCERT_E2E_BACKEND=symphony pnpm test:e2e:claude-linear` | symphony の既存 Linear adapter で動く、PASS |

---

## §9 テスト戦略

### Unit tests (in-source `import.meta.vitest`)

| 対象 | テスト内容 |
|---|---|
| `domain/issue-extra.ts` | discriminated union narrow (kind === "github" でフィールド narrow) |
| `domain/issue.ts` | `extra` 省略時の構築、`extra` 付き構築 |
| `domain/errors.ts` | 9 variant の discrimination (kind ベース) |
| `config/schema.ts` (github 分岐) | (1) `api_key: $GITHUB_TOKEN` が env から解決 (2) env 未設定で invariant-violation (3) literal `api_key` 通過 (4) `assignee: $GITHUB_ASSIGNEE` 同様 (5) `assignee: me` は literal 通過 |
| `tracker/github/client.ts` | 200 / 401 → `github-http` / `errors` envelope → `github-graphql-errors` / schema mismatch → `github-response-invalid` / fetch throw → `github-network` / timeout (`AbortSignal`) |
| `tracker/github/queries.ts` | (1) `POLL_ITEMS_QUERY` response の正常 shape accept (2) `description=null` accept (3) `PullRequest` / `DraftIssue` 混在 accept (4) `ProjectV2ItemFieldTextValue` などの other field type 混在 accept (5) `user=null` / `organization=null` accept |
| `tracker/github/project-meta.ts` | (1) user scope で成功 (2) user null → org fallback 成功 (3) 両方 null → `github-project-not-found` (4) Status field 不在 → `github-status-field-not-found` (5) `activeStates` の一部が options に不在 → `github-status-option-not-found` (6) `doingState` 不在も同様 (7) `viewer.login` 取得経路 (8) viewer 失敗 → warmup 全体が Failure |
| `tracker/github/adapter.ts` (構築) | warmup 失敗を Failure として伝搬 / `assignee="me"` が viewerLogin に解決 (追加 fetch なし) / `assignee=undefined` で filter=none |
| `tracker/github/adapter.ts` (5 callbacks) | (1) `fetchCandidateIssues` pagination (2 page を結合) (2) `PullRequest` / `DraftIssue` を除外、`content=null` を除外 (3) `state ∈ activeStates` 後フィルタ (4) `assigneeFilter.login` で first assignee 一致のみ通過 (5) `fetchIssueStatesByIds` で id 順保持 (6) 該当 projectItems が無い issue は skip (7) `createComment` の `errors` → `github-graphql-errors` |
| `tracker/github/adapter.ts` (retry) | `vi.useFakeTimers()` で: (1) 1 回目失敗 / 2 回目成功 → ok (2) 3 連続失敗 → `ok(undefined)` + warn log spy (3) `issue.extra` 不在 → `github-no-project-item` 即返し、retry されない (4) option name 不在 → `github-status-option-not-found` 即返し、retry されない |
| `tracker/factory.ts` | github 分岐が `createGithubTracker` を await して Result を返す (memory/linear 既存テストは不変) |
| `cli/run.ts` の `formatTrackerError` | 各 github-* variant が human-readable 文字列に整形 (snapshot で 1 件、9 variant の代表値で 8 件 assertEquals) |

### Integration test (`apps/conductor/test/integration/tracker-github-flow.test.ts` 新規)

Linear と同型。`createGithubTracker(config, { logger, fetch: spyFetch })` で fetch を直接 DI してシナリオを通す:

1. **happy path (user scope)**: warmup user scope 成功 + viewer + `fetchCandidateIssues` で 1 page → `updateIssueState(issue, "Done")` → `success: true`。fetch call sequence と request body を assert
2. **org fallback**: warmup user null → org scope retry 成功 → 以降同じ
3. **best-effort retry**: `updateIssueState` で 3 連続 500 → `ok(undefined)` + warn log
4. **`extra` 不在ガード**: warmup 後、`extra` 抜きの Issue を `updateIssueState` に渡す → `github-no-project-item` Failure

### E2E test

- **`apps/conductor/test/e2e/` には GitHub E2E を置かない**。実 API トークン依存は repo-wide E2E に集約 (Linear と同じ方針)
- 既存 `conductor-claude-memory.test.ts` / `conductor-codex-memory.test.ts` は不変

### Repo-wide E2E (`apps/e2e/claude-github.ts`)

- スクリプト本体は変更なし
- `resolveBackendCommand()` 経由でデフォ起動が conductor になる
- 動作確認手順:
  ```
  pnpm build && pnpm dev:install && pnpm --filter e2e build
  GITHUB_TOKEN=ghp_xxx pnpm test:e2e:claude-github                          # conductor
  GITHUB_TOKEN=ghp_xxx CONCERT_E2E_BACKEND=symphony pnpm test:e2e:claude-github  # 旧経路で比較
  ```

### `vitest.config.ts`

既存設定 (`include: ["test/**/*.test.ts"]`) で integration test もそのまま拾われる。設定変更なし。

---

## §10 完了判定 + リスク

### 完了判定

1. `pnpm --filter conductor test` 全件緑 (Phase 3 + Phase 4)
2. `pnpm --filter conductor build` 成功
3. `pnpm test:e2e:claude-github` (conductor) で `babie/concert#1` が `Todo → In Progress → Done` で PASS
4. `CONCERT_E2E_BACKEND=symphony pnpm test:e2e:claude-github` でも PASS (回帰なし)
5. `pnpm test:e2e:claude-linear` 両経路で PASS (Linear 回帰なし)
6. 起動時 config dump で `github.apiKey` が `*****`
7. TODO.md M3 Phase 4 の 6 項目すべてチェック

### リスクと緩和

| リスク | 影響 | 緩和 |
|---|---|---|
| `description=null` を見逃して valibot 検証失敗 | E2E が即時 fail | queries.ts schema で `v.nullable(v.string())` を最初から入れ、unit test で網羅 |
| `PullRequest` / `DraftIssue` を Issue としてカウントしてしまう | 別 PR の状態を変更しようとして API エラー | normalize 前に `content.__typename === "Issue"` ガード、unit test で混在 page を網羅 |
| `ProjectV2ItemFieldTextValue` などの非-SingleSelect field を valibot が reject | warmup / fetch が即時 fail | response schema を `v.union(...)` で other field type も accept (filter 時に弾く) |
| `Issue.extra` が undefined のまま GitHub adapter の `updateIssueState` に来る | `Cannot read properties of undefined` runtime crash | retry helper 入口で kind guard、`github-no-project-item` を返す。unit test で `extra=undefined` ケースを必ず網羅 |
| user スコープが project を見つけた case で誤って org にも fallback して double API | rate-limit 早出し | `data.user !== null && data.user.projectV2 !== null` の両方を見て fallback 判断、unit test で「user スコープで成功時 org query は呼ばれない」を assert |
| viewer query が assignee 未設定でも呼ばれて余計な API クォータを食う | 起動遅延 ~50ms | symphony 互換のため **意図的** に常に呼ぶ。warmup は 1 度だけなので許容 |
| `apps/e2e/workflow.claude-github.md` に `api_key: $GITHUB_TOKEN` を追加した結果 symphony 経路が壊れる | E2E 回帰 | symphony は `resolve_secret_setting` で env ref 解決済、Phase 4 着手早期に 1 度手動で `CONCERT_E2E_BACKEND=symphony` を走らせて確認 |
| retry の `vi.useFakeTimers()` が `delay()` と組み合わせて hang | テスト timeout | Linear で実証済の `vi.advanceTimersByTimeAsync(250)` / `1000` パターンを踏襲 |
| GITHUB_TOKEN が log に漏れる | secret 漏洩 | `githubGraphqlRequest` 内で error.body を 1000 bytes truncate、Authorization 値は log に絶対出さない unit test で代表ケース検証 |
| ProjectMeta 検証エラー時のメッセージが分かりづらい | デバッグ困難 | `github-status-option-not-found` に `available: [...keys]` を必ず載せる、formatTrackerError で available を `, ` 区切りで表示 |
| Issue identifier に `/` が含まれる (`babie/concert#1`) | workspace path に `/` 混入 | conductor の `safeIdentifier` (`workspace/path.ts`) が `[^a-zA-Z0-9._-]` を `_` に置換するので `babie_concert_1` になる。symphony と同じ key で workspace が掘られる |

---

## 参考資料

- ルート [`CLAUDE.md`](../../../CLAUDE.md)
- [M3 overview spec](2026-05-15-m3-overview-design.md)
- [M3 Phase 1 spec](2026-05-16-m3-phase1-design.md)
- [M3 Phase 2 spec](2026-05-16-m3-phase2-design.md)
- [M3 Phase 3 spec](2026-05-16-m3-phase3-design.md)
- [ADR-0013 tracker block split by kind](../../adr/0013-tracker-block-split-by-kind.md)
- [ADR-0014 Symphony-owned state transitions](../../adr/0014-symphony-owned-state-transitions.md)
- 移植元 symphony GitHub client: [`apps/symphony/lib/symphony_elixir/github/client.ex`](../../../apps/symphony/lib/symphony_elixir/github/client.ex)
- 移植元 symphony GitHub adapter: [`apps/symphony/lib/symphony_elixir/github/adapter.ex`](../../../apps/symphony/lib/symphony_elixir/github/adapter.ex)
- 移植元 symphony ProjectMeta: [`apps/symphony/lib/symphony_elixir/github/project_meta.ex`](../../../apps/symphony/lib/symphony_elixir/github/project_meta.ex)
- 移植元 symphony Queries: [`apps/symphony/lib/symphony_elixir/github/queries.ex`](../../../apps/symphony/lib/symphony_elixir/github/queries.ex)
- 既存 E2E GitHub クライアント (参考): [`apps/e2e/claude-github.ts`](../../../apps/e2e/claude-github.ts)
