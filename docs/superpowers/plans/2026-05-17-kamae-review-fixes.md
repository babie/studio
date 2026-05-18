# kamae-review 指摘修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/conductor` に対する kamae-review の所見 (High 3, Medium 6, Low 5, Suggestion 1) を全て解消し、kamae 原則 (Discriminated Union narrowing / Result 一貫性 / Branded Types / Sensitive PII / Immutability) との適合度を上げる。

**Architecture:**
- Boundary schema を `v.variant("__typename", ...)` で組み直し、GitHub adapter から `as any` を駆逐する (F1/F2/F3/F8)
- `domain/errors.ts` を sub-system ごとに分割、`config/schema.ts` 内部の throw を Result 化、`assertNever` で exhaustive switch を強制
- API key を `Sensitive<string>` でラップし `JSON.stringify` 経由でも自動マスク
- `BackendConfig` の `type` discriminant 維持 (deviation コメント) と Result.pipe の全面活用は **M4+ に送る** (TODO.md 追記)

**Tech Stack:** TypeScript 6, valibot 1.x, `@praha/byethrow` 0.11, vitest 4 (in-source `import.meta.vitest`)

**前提:**
- 開始前に `pnpm --filter conductor test` が green であること
- 各タスク末尾の commit ステップ前に必ず `pnpm --filter conductor test` を走らせる

---

## File Structure

```
apps/conductor/src/
├── util/
│   ├── assert-never.ts        # 新規 (F6 全箇所で使用)
│   └── sensitive.ts           # 新規 (S1)
├── domain/
│   ├── errors.ts              # 削除 → 下記 6 ファイルに分割 (F7)
│   ├── config-errors.ts       # 新規 ConfigError
│   ├── tracker-errors.ts      # 新規 TrackerError
│   ├── backend-errors.ts      # 新規 BackendError
│   ├── workspace-errors.ts    # 新規 WorkspaceError
│   ├── prompt-errors.ts       # 新規 PromptError
│   ├── orchestrator-errors.ts # 新規 OrchestratorError
│   ├── tracker-config.ts      # apiKey: Sensitive<string> 化 (S1)
│   └── backend-config.ts      # deviation コメント追加 (F11)
├── config/
│   ├── schema.ts              # buildBackend / buildTracker を Result 化 (F5)
│   └── parser.ts              # try/catch 削除 (F5)
├── tracker/
│   ├── types.ts               # Tracker を function property notation 化 (F4)
│   ├── memory.ts              # MutableIssue 削除、map ベース (F9)
│   ├── factory.ts             # assertNever 適用 (F6)
│   ├── linear/
│   │   ├── client.ts          # p:any 排除 (F10) / .reveal() (S1)
│   │   └── adapter.ts         # updateStateWithRetry Result.pipe 化 (F15 部分)
│   └── github/
│       ├── queries.ts         # ★ FieldValue / ProjectField / Content を v.variant 化 (F1/F2/F3/F8)
│       ├── client.ts          # p:any 排除 (F10) / .reveal() (S1)
│       ├── adapter.ts         # as any 全駆除 + updateStateWithRetry pipe 化 (F1/F2/F8/F15)
│       └── project-meta.ts    # findStatusField narrow 化 (F3)
├── backend/
│   └── factory.ts             # assertNever 適用 (F6)
├── orchestrator/
│   └── orchestrator.ts        # Logger を function property notation 化 (F4)
├── cli/
│   └── run.ts                 # format*Error 群に assertNever (F6) / redact 削除 (S1)
└── util/
    └── redact.ts              # 削除 (S1 で不要に)
```

Test fixtures in 各 in-source `import.meta.vitest` ブロックを順次 `as const satisfies` + `v.parse(...schema, ...)` に置換 (F13/F14)。

---

## Phase A: Foundation utilities + error split

### Task 1: `assert-never` ユーティリティ追加

**Files:**
- Create: `apps/conductor/src/util/assert-never.ts`

- [ ] **Step 1: ファイル作成**

```typescript
/**
 * Exhaustiveness check for discriminated unions inside `switch` statements.
 * Calling this from a `default:` branch makes adding a new variant a compile error.
 *
 * @example
 *   switch (err.kind) {
 *     case "a": return ...;
 *     case "b": return ...;
 *     default: return assertNever(err);
 *   }
 */
export const assertNever = (x: never): never => {
  throw new Error(`assertNever: unexpected variant: ${JSON.stringify(x)}`);
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("util/assert-never", () => {
    it("throws with the offending value embedded", () => {
      expect(() => assertNever({ kind: "x" } as never)).toThrow(/unexpected variant.*"x"/);
    });
  });
}
```

- [ ] **Step 2: テスト確認**

Run: `pnpm --filter conductor test src/util/assert-never.ts`
Expected: 1 passed

- [ ] **Step 3: Commit**

```bash
git add apps/conductor/src/util/assert-never.ts
git commit -m "feat(conductor): add assertNever utility for exhaustive switch"
```

---

### Task 2: `Sensitive<T>` ユーティリティ追加

**Files:**
- Create: `apps/conductor/src/util/sensitive.ts`

- [ ] **Step 1: ファイル作成**

```typescript
/**
 * Opaque wrapper for PII / secrets. Reveals the underlying value only via
 * `.reveal()`; any string coercion (toString, JSON.stringify) emits "*****".
 *
 * Per kamae §4 (boundary-defense.md PII Protection), apply at the schema
 * boundary so the entire downstream pipeline sees the wrapped type.
 */
export type Sensitive<T> = Readonly<{
  readonly __sensitive: true;
  reveal: () => T;
  toString: () => string;
  toJSON: () => string;
}>;

export const Sensitive = {
  of: <T>(value: T): Sensitive<T> => ({
    __sensitive: true,
    reveal: () => value,
    toString: () => "*****",
    toJSON: () => "*****",
  }),
} as const;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("util/sensitive", () => {
    it("reveal() returns the original value", () => {
      const s = Sensitive.of("secret");
      expect(s.reveal()).toBe("secret");
    });
    it("toString returns ***** mask", () => {
      expect(String(Sensitive.of("secret"))).toBe("*****");
    });
    it("JSON.stringify emits ***** mask (no leak through stringify)", () => {
      expect(JSON.stringify({ apiKey: Sensitive.of("ghp_xxx") })).toBe('{"apiKey":"*****"}');
    });
    it("string concatenation triggers toString (also masked)", () => {
      expect(`key=${Sensitive.of("xxx")}`).toBe("key=*****");
    });
  });
}
```

- [ ] **Step 2: テスト確認**

Run: `pnpm --filter conductor test src/util/sensitive.ts`
Expected: 4 passed

- [ ] **Step 3: Commit**

```bash
git add apps/conductor/src/util/sensitive.ts
git commit -m "feat(conductor): add Sensitive<T> wrapper for PII auto-masking"
```

---

### Task 3: `domain/errors.ts` を sub-system 別に分割

`OrchestratorError` は他 5 種を集約するため、5 ファイル分割 → 集約ファイルの順で動かす。

**Files:**
- Create: `apps/conductor/src/domain/config-errors.ts`
- Create: `apps/conductor/src/domain/tracker-errors.ts`
- Create: `apps/conductor/src/domain/backend-errors.ts`
- Create: `apps/conductor/src/domain/workspace-errors.ts`
- Create: `apps/conductor/src/domain/prompt-errors.ts`
- Create: `apps/conductor/src/domain/orchestrator-errors.ts`
- Delete: `apps/conductor/src/domain/errors.ts`

- [ ] **Step 1: `config-errors.ts` 作成**

```typescript
// apps/conductor/src/domain/config-errors.ts
import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ConfigError =
  | Readonly<{ kind: "file-not-found"; path: string }>
  | Readonly<{ kind: "frontmatter-missing"; path: string }>
  | Readonly<{ kind: "yaml-parse-failed"; path: string; cause: string }>
  | Readonly<{
      kind: "schema-violation";
      path: string;
      issues: ReadonlyArray<StandardSchemaV1.Issue>;
    }>
  | Readonly<{ kind: "invariant-violation"; path: string; cause: string }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/config-errors", () => {
    it("discriminates by kind", () => {
      const e: ConfigError = { kind: "file-not-found", path: "/x.md" };
      expect(e.kind).toBe("file-not-found");
    });
  });
}
```

- [ ] **Step 2: `tracker-errors.ts` 作成**

```typescript
// apps/conductor/src/domain/tracker-errors.ts
export type TrackerError =
  | Readonly<{ kind: "unknown-state"; state: string }>
  | Readonly<{ kind: "issue-not-found"; id: string }>
  | Readonly<{ kind: "linear-http"; status: number; bodyExcerpt: string }>
  | Readonly<{ kind: "linear-graphql-errors"; messages: ReadonlyArray<string> }>
  | Readonly<{ kind: "linear-response-invalid"; issues: ReadonlyArray<string> }>
  | Readonly<{ kind: "linear-network"; cause: string }>
  | Readonly<{ kind: "linear-state-not-found"; stateName: string }>
  | Readonly<{ kind: "linear-config"; cause: string }>
  | Readonly<{ kind: "github-http"; status: number; bodyExcerpt: string }>
  | Readonly<{ kind: "github-graphql-errors"; messages: ReadonlyArray<string> }>
  | Readonly<{ kind: "github-response-invalid"; issues: ReadonlyArray<string> }>
  | Readonly<{ kind: "github-network"; cause: string }>
  | Readonly<{ kind: "github-project-not-found"; owner: string; number: number }>
  | Readonly<{ kind: "github-status-field-not-found"; fieldName: string }>
  | Readonly<{ kind: "github-status-option-not-found"; optionName: string; available: ReadonlyArray<string> }>
  | Readonly<{ kind: "github-no-project-item"; issueIdentifier: string }>
  | Readonly<{ kind: "github-config"; cause: string }>
  | Readonly<{ kind: "unsupported-tracker-kind"; kind_: string }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/tracker-errors", () => {
    it("discriminates github variants", () => {
      const e: TrackerError = { kind: "github-http", status: 401, bodyExcerpt: "x" };
      expect(e.kind).toBe("github-http");
    });
  });
}
```

- [ ] **Step 3: `backend-errors.ts` 作成**

```typescript
// apps/conductor/src/domain/backend-errors.ts
export type BackendError =
  | Readonly<{ kind: "mock-forced-failure"; reason: string }>
  | Readonly<{ kind: "spawn-failed"; command: string; cause: string }>
  | Readonly<{ kind: "stdio-protocol-error"; phase: "framing" | "json-parse" | "schema"; raw: string }>
  | Readonly<{ kind: "jsonrpc-error"; code: number; message: string; method?: string }>
  | Readonly<{ kind: "request-timeout"; method: string; timeoutMs: number }>
  | Readonly<{
      kind: "subprocess-crashed";
      signal: NodeJS.Signals | null;
      exitCode: number | null;
      stderrTail: string;
    }>
  | Readonly<{
      kind: "turn-not-completed";
      threadId: string;
      reason: "abort" | "exit-before-complete";
    }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/backend-errors", () => {
    it("discriminates subprocess-crashed", () => {
      const e: BackendError = { kind: "subprocess-crashed", signal: "SIGTERM", exitCode: null, stderrTail: "boom" };
      expect(e.kind).toBe("subprocess-crashed");
    });
  });
}
```

- [ ] **Step 4: `workspace-errors.ts` 作成**

```typescript
// apps/conductor/src/domain/workspace-errors.ts
export type WorkspaceError =
  | Readonly<{ kind: "path-unsafe"; path: string }>
  | Readonly<{ kind: "create-failed"; path: string; cause: string }>
  | Readonly<{
      kind: "hook-failed";
      hook: "before_run" | "after_create" | "before_remove" | "after_run";
      exitCode: number;
      stderrTail: string;
    }>
  | Readonly<{ kind: "hook-timeout"; hook: string; timeoutMs: number }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/workspace-errors", () => {
    it("discriminates hook-failed", () => {
      const e: WorkspaceError = { kind: "hook-failed", hook: "after_create", exitCode: 1, stderrTail: "x" };
      expect(e.hook).toBe("after_create");
    });
  });
}
```

- [ ] **Step 5: `prompt-errors.ts` 作成**

```typescript
// apps/conductor/src/domain/prompt-errors.ts
export type PromptError =
  | Readonly<{ kind: "template-parse-failed"; cause: string }>
  | Readonly<{ kind: "render-failed"; cause: string; missingVariables?: ReadonlyArray<string> }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/prompt-errors", () => {
    it("discriminates render-failed with missingVariables", () => {
      const e: PromptError = { kind: "render-failed", cause: "x", missingVariables: ["a"] };
      expect(e.kind).toBe("render-failed");
    });
  });
}
```

- [ ] **Step 6: `orchestrator-errors.ts` 作成 (集約)**

```typescript
// apps/conductor/src/domain/orchestrator-errors.ts
import type { ConfigError } from "./config-errors.js";
import type { TrackerError } from "./tracker-errors.js";
import type { BackendError } from "./backend-errors.js";
import type { WorkspaceError } from "./workspace-errors.js";
import type { PromptError } from "./prompt-errors.js";

export type OrchestratorError =
  | Readonly<{ kind: "config"; error: ConfigError }>
  | Readonly<{ kind: "tracker"; error: TrackerError }>
  | Readonly<{ kind: "backend"; error: BackendError }>
  | Readonly<{ kind: "workspace"; error: WorkspaceError }>
  | Readonly<{ kind: "prompt"; error: PromptError }>
  | Readonly<{ kind: "guardrail-missing"; flag: string }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/orchestrator-errors", () => {
    it("nests sub-errors by kind", () => {
      const e: OrchestratorError = { kind: "workspace", error: { kind: "create-failed", path: "/x", cause: "perm" } };
      expect(e.kind).toBe("workspace");
    });
    it("supports guardrail-missing", () => {
      const e: OrchestratorError = { kind: "guardrail-missing", flag: "--i-understand-..." };
      expect(e.kind).toBe("guardrail-missing");
    });
  });
}
```

- [ ] **Step 7: 全 import を新ファイルに付け替え**

旧 `errors.ts` の import を該当 sub-system に振り替える。以下のシェルで一覧を取得して 1 つずつ置換:

```bash
grep -rn 'from "[^"]*domain/errors\.js"' apps/conductor/src apps/conductor/test
```

期待される置換マッピング:
- `ConfigError` → `../domain/config-errors.js`
- `TrackerError` → `../domain/tracker-errors.js`
- `BackendError` → `../domain/backend-errors.js`
- `WorkspaceError` → `../domain/workspace-errors.js`
- `PromptError` → `../domain/prompt-errors.js`
- `OrchestratorError` → `../domain/orchestrator-errors.js`

具体的に修正するファイル (相対パスは各ファイル基準):
- `apps/conductor/src/config/schema.ts:5` → `config-errors.js` には依存しない (parser.ts 経由)
- `apps/conductor/src/config/loader.ts:3` → `from "../domain/config-errors.js"`
- `apps/conductor/src/config/parser.ts:3` → `from "../domain/config-errors.js"`
- `apps/conductor/src/tracker/types.ts:3` → `from "../domain/tracker-errors.js"`
- `apps/conductor/src/tracker/factory.ts:3` → `from "../domain/tracker-errors.js"`
- `apps/conductor/src/tracker/memory.ts:4` → `from "../domain/tracker-errors.js"`
- `apps/conductor/src/tracker/linear/adapter.ts:4` → `from "../../domain/tracker-errors.js"`
- `apps/conductor/src/tracker/linear/client.ts:3` → `from "../../domain/tracker-errors.js"`
- `apps/conductor/src/tracker/github/adapter.ts:5` → `from "../../domain/tracker-errors.js"`
- `apps/conductor/src/tracker/github/client.ts:3` → `from "../../domain/tracker-errors.js"`
- `apps/conductor/src/tracker/github/project-meta.ts:4` → `from "../../domain/tracker-errors.js"`
- `apps/conductor/src/backend/types.ts:4` → `from "../domain/backend-errors.js"`
- `apps/conductor/src/backend/mock.ts:3` → `from "../domain/backend-errors.js"`
- `apps/conductor/src/backend/claude.ts:3` → `from "../domain/backend-errors.js"`
- `apps/conductor/src/backend/codex.ts:3` → `from "../domain/backend-errors.js"`
- `apps/conductor/src/backend/jsonrpc/client.ts:3` → `from "../../domain/backend-errors.js"`
- `apps/conductor/src/backend/jsonrpc/errors.ts:1` → `from "../../domain/backend-errors.js"`
- `apps/conductor/src/backend/jsonrpc/transport.ts:3` → `from "../../domain/backend-errors.js"`
- `apps/conductor/src/workspace/manager.ts:6` → `from "../domain/workspace-errors.js"`
- `apps/conductor/src/workspace/path.ts:3` → `from "../domain/workspace-errors.js"`
- `apps/conductor/src/workspace/hooks.ts:4` → `from "../domain/workspace-errors.js"`
- `apps/conductor/src/prompt/builder.ts:4` → `from "../domain/prompt-errors.js"`
- `apps/conductor/src/orchestrator/orchestrator.ts:5` → `from "../domain/orchestrator-errors.js"`
- `apps/conductor/src/orchestrator/agent-runner.ts:3` → `from "../domain/orchestrator-errors.js"`
- `apps/conductor/src/cli/run.ts:8` → 5 つ全部:
  ```typescript
  import type { BackendError } from "../domain/backend-errors.js";
  import type { ConfigError } from "../domain/config-errors.js";
  import type { OrchestratorError } from "../domain/orchestrator-errors.js";
  import type { TrackerError } from "../domain/tracker-errors.js";
  import type { WorkspaceError } from "../domain/workspace-errors.js";
  import type { PromptError } from "../domain/prompt-errors.js";
  ```

- [ ] **Step 8: 旧 `errors.ts` を削除**

```bash
rm apps/conductor/src/domain/errors.ts
```

- [ ] **Step 9: テスト全体実行**

Run: `pnpm --filter conductor test`
Expected: 全 test green (compile + behaviour 不変)

- [ ] **Step 10: Commit**

```bash
git add apps/conductor/src/domain apps/conductor/src
git commit -m "refactor(conductor): split domain/errors.ts by sub-system"
```

---

## Phase B: GitHub schema variant 化 + `as any` 駆除 (F1/F2/F3/F8)

### Task 4: `FieldValueSchema` を `v.variant("__typename", ...)` 化

PollItem 内の `fieldValues.nodes` と IssuesByIds 内の `projectItems.fieldValues.nodes` で同じスキーマを使う。両者で narrow できるよう discriminated union 化する。

**Files:**
- Modify: `apps/conductor/src/tracker/github/queries.ts:206-219`

- [ ] **Step 1: 失敗テストを `queries.ts` 内 vitest ブロックに追加**

`apps/conductor/src/tracker/github/queries.ts` のテストブロックに以下を追記:

```typescript
    it("FieldValue narrows via __typename when parsed (SingleSelect arm has field/name)", () => {
      const raw = {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        field: { name: "Status" },
        name: "Todo",
        optionId: "opt_todo",
      };
      const r = v.safeParse(FieldValueSchema, raw);
      if (!r.success) throw new Error("expected success");
      // type-level narrowing check: discriminated union must allow direct property access.
      if (r.output.__typename === "ProjectV2ItemFieldSingleSelectValue") {
        expect(r.output.field.name).toBe("Status");
        expect(r.output.name).toBe("Todo");
      }
    });
```

注: `FieldValueSchema` は現状 export されていない。テスト動作のため Step 2 で `export` を追加する。

- [ ] **Step 2: `queries.ts:217` `FieldValueSchema` を `v.variant` で書き直す**

206-217 行を以下に置換:

```typescript
const SingleSelectFieldValueSchema = v.object({
  __typename: v.literal("ProjectV2ItemFieldSingleSelectValue"),
  field: v.object({ name: v.string() }),
  name: v.nullable(v.string()),
  optionId: v.optional(v.nullable(v.string())),
});

// Other __typename variants are passed through as a catch-all so PollItems can
// contain any ProjectV2ItemField* shape without breaking validation.
const OtherFieldValueSchema = v.object({
  __typename: v.string(),
});

export const FieldValueSchema = v.variant("__typename", [
  SingleSelectFieldValueSchema,
  OtherFieldValueSchema,
]);
```

注: `v.variant` の catch-all arm として `v.object({ __typename: v.string() })` を 2 番目に置く。valibot は最初の variant arm から順に試すので、`ProjectV2ItemFieldSingleSelectValue` 文字列は先に SingleSelect arm にマッチする。

- [ ] **Step 3: テスト実行**

Run: `pnpm --filter conductor test src/tracker/github/queries.ts`
Expected: 全 test green、新規 narrowing テストも pass

- [ ] **Step 4: Commit**

```bash
git add apps/conductor/src/tracker/github/queries.ts
git commit -m "refactor(conductor): FieldValueSchema as v.variant for narrowing"
```

---

### Task 5: `github/adapter.ts` で `extractStatusRaw` / `extractStatusFromProjectItem` の `as any` を narrow 経由に置換

**Files:**
- Modify: `apps/conductor/src/tracker/github/adapter.ts:48-59,149-162`

- [ ] **Step 1: `extractStatusRaw` を narrowing で書き直す**

48-59 行を以下に置換:

```typescript
const extractStatusRaw = (fieldValues: PollItemNode["fieldValues"]): string | null => {
  for (const fv of fieldValues.nodes) {
    if (fv.__typename !== "ProjectV2ItemFieldSingleSelectValue") continue;
    if (fv.field.name !== "Status") continue;
    if (typeof fv.name === "string" && fv.name.length > 0) return fv.name;
  }
  return null;
};
```

- [ ] **Step 2: `extractStatusFromProjectItem` を同様に書き直す**

149-162 行を以下に置換:

```typescript
const extractStatusFromProjectItem = (
  fieldValues: IssueByIdNode["projectItems"]["nodes"][number]["fieldValues"],
): string | null => {
  for (const fv of fieldValues.nodes) {
    if (fv.__typename !== "ProjectV2ItemFieldSingleSelectValue") continue;
    if (fv.field.name !== "Status") continue;
    if (typeof fv.name === "string" && fv.name.length > 0) return fv.name;
  }
  return null;
};
```

- [ ] **Step 3: テスト確認**

Run: `pnpm --filter conductor test src/tracker/github/adapter.ts`
Expected: 全 test green、既存の `extractStatusRaw` テストも pass

- [ ] **Step 4: Commit**

```bash
git add apps/conductor/src/tracker/github/adapter.ts
git commit -m "refactor(conductor): drop 'as any' in github extractStatus helpers"
```

---

### Task 6: `ProjectFieldSchema` を `v.variant("__typename", ...)` 化 + `findStatusField` narrow

**Files:**
- Modify: `apps/conductor/src/tracker/github/queries.ts:160-172`
- Modify: `apps/conductor/src/tracker/github/project-meta.ts:23-44`

- [ ] **Step 1: `queries.ts` の `ProjectFieldSchema` を `v.variant` 化**

160-172 行を以下に置換:

```typescript
const SingleSelectFieldSchema = v.object({
  __typename: v.literal("ProjectV2SingleSelectField"),
  id: v.string(),
  name: v.string(),
  options: v.array(v.object({ id: v.string(), name: v.string() })),
});

// Catch-all for non-SingleSelect field types (ProjectV2Field, ProjectV2IterationField, etc.)
const OtherProjectFieldSchema = v.object({
  __typename: v.string(),
});

const ProjectFieldSchema = v.variant("__typename", [
  SingleSelectFieldSchema,
  OtherProjectFieldSchema,
]);

// Re-export for project-meta.ts type inference
export type SingleSelectFieldNode = v.InferOutput<typeof SingleSelectFieldSchema>;
```

- [ ] **Step 2: `project-meta.ts` の `findStatusField` を narrowing 経由に**

23-44 行 (`ProjectInner` の type alias + `findStatusField`) を以下に置換:

```typescript
type ProjectInner = v.InferOutput<typeof ProjectMetaUserResponseSchema>["data"]["user"] extends infer U
  ? U extends null
    ? never
    : U extends { projectV2: infer P }
      ? P extends null
        ? never
        : P
      : never
  : never;

const findStatusField = (
  inner: ProjectInner,
): Result.Result<{ fieldId: string; options: ReadonlyMap<string, string> }, TrackerError> => {
  for (const node of inner.fields.nodes) {
    if (node.__typename !== "ProjectV2SingleSelectField") continue;
    if (node.name !== "Status") continue;
    const options = new Map(node.options.map((o) => [o.name, o.id]));
    return { type: "Success", value: { fieldId: node.id, options } };
  }
  return { type: "Failure", error: { kind: "github-status-field-not-found", fieldName: "Status" } };
};
```

- [ ] **Step 3: テスト実行**

Run: `pnpm --filter conductor test src/tracker/github`
Expected: 全 test green

- [ ] **Step 4: Commit**

```bash
git add apps/conductor/src/tracker/github/queries.ts apps/conductor/src/tracker/github/project-meta.ts
git commit -m "refactor(conductor): ProjectField as v.variant; drop 'as any' in findStatusField"
```

---

### Task 7: `IssueContent` / `IssueByIdNode` を variant 化、`toIssueFromIssueNode` を narrow 化

**Files:**
- Modify: `apps/conductor/src/tracker/github/queries.ts:229-247,279-301`
- Modify: `apps/conductor/src/tracker/github/adapter.ts:120-145,200-205`

- [ ] **Step 1: `ContentSchema` と `IssuesByIdsResponseSchema` を `v.variant` 化**

`queries.ts` の 229-247 行 (PollItem の `ContentSchema`) を:

```typescript
const IssueContentSchema = v.object({
  __typename: v.literal("Issue"),
  id: v.string(),
  number: v.number(),
  title: v.string(),
  body: v.nullable(v.string()),
  url: v.optional(v.string()),
  repository: v.object({ nameWithOwner: v.string() }),
  assignees: v.optional(AssigneesSchema),
  labels: v.optional(LabelsSchema),
  createdAt: v.optional(v.nullable(v.string())),
  updatedAt: v.optional(v.nullable(v.string())),
});

const OtherContentSchema = v.object({
  __typename: v.string(),
});

const ContentSchema = v.nullable(
  v.variant("__typename", [IssueContentSchema, OtherContentSchema]),
);
```

`queries.ts` の 279-301 行 (IssuesByIds 側) を:

```typescript
const IssueByIdNodeSchema = v.object({
  __typename: v.literal("Issue"),
  id: v.string(),
  number: v.number(),
  title: v.string(),
  body: v.nullable(v.string()),
  url: v.optional(v.string()),
  repository: v.object({ nameWithOwner: v.string() }),
  projectItems: v.object({ nodes: v.array(ProjectItemRefSchema) }),
  assignees: v.optional(AssigneesSchema),
  labels: v.optional(LabelsSchema),
  createdAt: v.optional(v.nullable(v.string())),
  updatedAt: v.optional(v.nullable(v.string())),
});

const OtherNodeSchema = v.object({
  __typename: v.string(),
});

export const IssuesByIdsResponseSchema = v.object({
  data: v.object({
    nodes: v.array(
      v.nullable(v.variant("__typename", [IssueByIdNodeSchema, OtherNodeSchema])),
    ),
  }),
});

export type IssueByIdNode = v.InferOutput<typeof IssueByIdNodeSchema>;
```

- [ ] **Step 2: `adapter.ts` `isIssueContent` の戻り型を narrow に合わせる + `as any` 削除**

`adapter.ts:120-145` の `isIssueContent` と `filterAndNormalize` を以下に置換:

```typescript
type IssueContentNarrowed = Extract<PollItemNode["content"], { __typename: "Issue" }>;

const isIssueContent = (
  item: PollItemNode,
): item is PollItemNode & { content: IssueContentNarrowed } =>
  item.content !== null && item.content.__typename === "Issue";

const filterAndNormalize = (
  meta: GithubProjectMeta,
  items: ReadonlyArray<PollItemNode>,
  stateAllow: ReadonlySet<string>,
  assigneeFilter: AssigneeFilter,
): ReadonlyArray<Issue> => {
  const out: Issue[] = [];
  for (const item of items) {
    if (!isIssueContent(item)) continue;
    const state = extractStatusRaw(item.fieldValues);
    if (state === null) continue;
    if (!stateAllow.has(state)) continue;
    if (assigneeFilter.kind === "login") {
      const login = firstAssigneeLogin(item.content.assignees);
      if (login !== assigneeFilter.login) continue;
    }
    out.push(toIssueFromPollItem(meta, item, state));
  }
  return out;
};
```

注: `firstAssigneeLogin` 引数は `item.content.assignees`。`IssueContentNarrowed` に `assignees?: AssigneesSchema` が入っているので `as any` 不要。

- [ ] **Step 3: `toIssueFromPollItem` の引数型を narrowed 型に合わせる**

`adapter.ts:69-85` を:

```typescript
const toIssueFromPollItem = (
  meta: GithubProjectMeta,
  item: PollItemNode & { content: IssueContentNarrowed },
  state: string,
): Issue => {
  const identifier = `${item.content.repository.nameWithOwner}#${item.content.number}`;
  return {
    id: v.parse(IssueId.schema, item.content.id),
    identifier: v.parse(IssueIdentifier.schema, identifier),
    title: item.content.title,
    description: item.content.body ?? "",
    state: v.parse(IssueStateName.schema, state),
    extra: { kind: "github", projectId: meta.projectId, projectItemId: item.id },
  };
};
```

- [ ] **Step 4: `fetchIssuesByIds` の `raw as IssueByIdNode` を narrow に**

`adapter.ts:200-205` を:

```typescript
    for (const raw of r.value.data.nodes) {
      if (raw === null) continue;
      if (raw.__typename !== "Issue") continue;
      // raw is now narrowed to IssueByIdNode via discriminated union
      const issue = toIssueFromIssueNode(meta, raw);
      if (issue !== null) acc.push(issue);
    }
```

- [ ] **Step 5: テスト実行**

Run: `pnpm --filter conductor test src/tracker/github`
Expected: 全 test green

- [ ] **Step 6: Commit**

```bash
git add apps/conductor/src/tracker/github/queries.ts apps/conductor/src/tracker/github/adapter.ts
git commit -m "refactor(conductor): IssueContent as v.variant; drop final 'as any' in github adapter"
```

---

### Task 8: `grep` で github tracker から `as any` が消えたか確認

- [ ] **Step 1: production code に `as any` が残っていないことを確認**

Run:

```bash
grep -n "as any" apps/conductor/src/tracker/github/adapter.ts apps/conductor/src/tracker/github/project-meta.ts apps/conductor/src/tracker/github/client.ts apps/conductor/src/tracker/github/queries.ts | grep -v "vitest" | grep -v "describe\|expect\|it(" | grep -v "^.*:.*//.*as any"
```

Expected: production スコープ (vitest ブロック外) の `as any` がゼロ件

注: vitest 内の `as any` は Phase H で扱う。

- [ ] **Step 2: コミット不要 (確認のみ)**

---

## Phase C: Boundary parser を Result 化 (F5)

### Task 9: `config/schema.ts` の `buildBackend` / `buildTracker` を Result 返却にリファクタ

**Files:**
- Modify: `apps/conductor/src/config/schema.ts`

- [ ] **Step 1: parser 内部用 error 型を定義し、build* を Result 化**

`schema.ts` のトップに internal error 型を追加:

```typescript
import type { Result } from "@praha/byethrow";
// ...existing imports

/** Internal error from buildBackend / buildTracker. Parser (config/parser.ts)
 *  attaches the file path before wrapping into ConfigError.invariant-violation. */
export type WorkflowYamlInvariant = Readonly<{ kind: "invariant"; cause: string }>;

export type WorkflowYamlError =
  | Readonly<{ kind: "schema-violation"; issues: ReadonlyArray<StandardSchemaV1.Issue> }>
  | Readonly<{ kind: "invariant-violation"; cause: string }>;
```

注: `StandardSchemaV1` を import: `import type { StandardSchemaV1 } from "@standard-schema/spec";`

- [ ] **Step 2: `buildBackend` を Result 化**

121-153 行を以下に置換:

```typescript
const buildBackend = (yaml: WorkflowYaml): Result.Result<BackendConfig, WorkflowYamlInvariant> => {
  switch (yaml.agent.type) {
    case "claude": {
      if (!yaml.claude) {
        return { type: "Failure", error: { kind: "invariant", cause: "agent.type=claude requires a `claude:` block" } };
      }
      const out: ClaudeBackend = { type: "claude", command: yaml.claude.command };
      return { type: "Success", value: out };
    }
    case "codex": {
      if (!yaml.codex) {
        return { type: "Failure", error: { kind: "invariant", cause: "agent.type=codex requires a `codex:` block" } };
      }
      const out: CodexBackend = {
        type: "codex",
        command: yaml.codex.command,
        approvalPolicy: yaml.codex.approval_policy,
        threadSandbox: yaml.codex.thread_sandbox,
        turnSandboxPolicy: yaml.codex.turn_sandbox_policy,
      };
      return { type: "Success", value: out };
    }
    case "mock": {
      const block = yaml.mock ?? {};
      const out: MockBackend = {
        type: "mock",
        ...(block.delay_ms !== undefined ? { delayMs: block.delay_ms } : {}),
        ...(block.force_fail !== undefined ? { forceFail: block.force_fail } : {}),
      };
      return { type: "Success", value: out };
    }
  }
};
```

- [ ] **Step 3: `buildAgent` を Result 化**

155-159 行を以下に置換:

```typescript
const buildAgent = (yaml: WorkflowYaml): Result.Result<AgentConfig, WorkflowYamlInvariant> => {
  const backend = buildBackend(yaml);
  if (backend.type === "Failure") return backend;
  return {
    type: "Success",
    value: {
      backend: backend.value,
      maxConcurrentAgents: yaml.agent.max_concurrent_agents,
      maxTurns: yaml.agent.max_turns,
    },
  };
};
```

- [ ] **Step 4: `buildTracker` を Result 化 (throw を全て return failure に)**

163-230 行を以下に置換:

```typescript
const buildTracker = (yaml: WorkflowYaml): Result.Result<TrackerConfig, WorkflowYamlInvariant> => {
  const common = {
    activeStates: yaml.tracker.active_states,
    terminalStates: yaml.tracker.terminal_states,
    ...(yaml.tracker.doing_state !== undefined ? { doingState: yaml.tracker.doing_state } : {}),
    ...(yaml.tracker.done_state !== undefined ? { doneState: yaml.tracker.done_state } : {}),
  };
  switch (yaml.tracker.kind) {
    case "memory": {
      const issues = (yaml.memory?.issues ?? []).map(buildIssue);
      const out: MemoryTrackerConfig = { kind: "memory", ...common, issues };
      return { type: "Success", value: out };
    }
    case "linear": {
      if (!yaml.linear) {
        return { type: "Failure", error: { kind: "invariant", cause: "tracker.kind=linear requires a `linear:` block" } };
      }
      const apiKeyR = resolveEnvRef(yaml.linear.api_key);
      if (apiKeyR.type === "Failure") {
        return { type: "Failure", error: { kind: "invariant", cause: `linear.api_key: ${apiKeyR.error.kind} ($${apiKeyR.error.var})` } };
      }
      let assignee: string | undefined;
      if (yaml.linear.assignee !== undefined) {
        const r = resolveEnvRef(yaml.linear.assignee);
        if (r.type === "Failure") {
          return { type: "Failure", error: { kind: "invariant", cause: `linear.assignee: ${r.error.kind} ($${r.error.var})` } };
        }
        assignee = r.value;
      }
      const out: LinearTrackerConfig = {
        kind: "linear",
        ...common,
        apiKey: apiKeyR.value,
        ...(yaml.linear.endpoint !== undefined ? { endpoint: yaml.linear.endpoint } : {}),
        projectSlug: yaml.linear.project_slug,
        ...(assignee !== undefined ? { assignee } : {}),
      };
      return { type: "Success", value: out };
    }
    case "github": {
      if (!yaml.github) {
        return { type: "Failure", error: { kind: "invariant", cause: "tracker.kind=github requires a `github:` block" } };
      }
      const apiKeyR = resolveEnvRef(yaml.github.api_key);
      if (apiKeyR.type === "Failure") {
        return { type: "Failure", error: { kind: "invariant", cause: `github.api_key: ${apiKeyR.error.kind} ($${apiKeyR.error.var})` } };
      }
      let assignee: string | undefined;
      if (yaml.github.assignee !== undefined) {
        const r = resolveEnvRef(yaml.github.assignee);
        if (r.type === "Failure") {
          return { type: "Failure", error: { kind: "invariant", cause: `github.assignee: ${r.error.kind} ($${r.error.var})` } };
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
      return { type: "Success", value: out };
    }
  }
};
```

- [ ] **Step 5: `parseWorkflowYaml` を `WorkflowYamlError` 返却に**

249-276 行を以下に置換:

```typescript
/**
 * Parses a raw YAML object (already loaded by js-yaml) and transforms it into
 * the strongly-typed `WorkflowConfig`. Does NOT attach the markdown prompt
 * body — caller (config/parser.ts) does that.
 *
 * Returns a byethrow Result. Both schema violations and cross-block invariant
 * failures (e.g., agent.type=claude requires a claude: block) come back as
 * Failure; the caller in config/parser.ts maps them to ConfigError.
 */
export const parseWorkflowYaml = (
  raw: unknown,
): Result.Result<Omit<WorkflowConfig, "prompt">, WorkflowYamlError> => {
  const yamlResult = schemaResult(WorkflowYamlSchema)(raw);
  if (yamlResult.type === "Failure") {
    return { type: "Failure", error: { kind: "schema-violation", issues: yamlResult.error.issues } };
  }
  const yaml = yamlResult.value;
  const agentR = buildAgent(yaml);
  if (agentR.type === "Failure") {
    return { type: "Failure", error: { kind: "invariant-violation", cause: agentR.error.cause } };
  }
  const trackerR = buildTracker(yaml);
  if (trackerR.type === "Failure") {
    return { type: "Failure", error: { kind: "invariant-violation", cause: trackerR.error.cause } };
  }
  const workspace = buildWorkspace(yaml);
  const hooks = buildHooks(yaml);
  const out: Omit<WorkflowConfig, "prompt"> = {
    agent: agentR.value,
    tracker: trackerR.value,
    ...(workspace !== undefined ? { workspace } : {}),
    ...(hooks !== undefined ? { hooks } : {}),
  };
  return { type: "Success", value: out };
};
```

- [ ] **Step 6: vitest ブロックの "throws" テストを Result Failure チェックに更新**

`schema.ts:325` の `it("throws when agent.type=claude but no claude: block", ...)`:

```typescript
    it("returns invariant-violation Failure when agent.type=claude has no claude: block", () => {
      const raw = {
        agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
        tracker: { kind: "memory" },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("invariant-violation");
      if (r.error.kind === "invariant-violation") {
        expect(r.error.cause).toMatch(/claude: block/);
      }
    });
```

`schema.ts:387`:

```typescript
    it("returns invariant-violation when linear.api_key references missing env var", () => {
      const prev = process.env.LINEAR_NOTSET;
      delete process.env.LINEAR_NOTSET;
      try {
        const raw = {
          agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
          claude: { command: "claude-app-server" },
          tracker: { kind: "linear", terminal_states: ["Done"] },
          linear: { api_key: "$LINEAR_NOTSET", project_slug: "p" },
        };
        const r = parseWorkflowYaml(raw);
        if (r.type !== "Failure") throw new Error("expected failure");
        expect(r.error.kind).toBe("invariant-violation");
        if (r.error.kind === "invariant-violation") {
          expect(r.error.cause).toMatch(/linear\.api_key: missing-env \(\$LINEAR_NOTSET\)/);
        }
      } finally {
        if (prev !== undefined) process.env.LINEAR_NOTSET = prev;
      }
    });
```

`schema.ts:436`: github 版も同様パターンで更新:

```typescript
    it("returns invariant-violation when github.api_key references missing env var", () => {
      const prev = process.env.GH_NOTSET;
      delete process.env.GH_NOTSET;
      try {
        const raw = {
          agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
          claude: { command: "claude-app-server" },
          tracker: { kind: "github", terminal_states: ["Done"] },
          github: { api_key: "$GH_NOTSET", project_owner: "o", project_number: 1 },
        };
        const r = parseWorkflowYaml(raw);
        if (r.type !== "Failure") throw new Error("expected failure");
        expect(r.error.kind).toBe("invariant-violation");
      } finally {
        if (prev !== undefined) process.env.GH_NOTSET = prev;
      }
    });
```

- [ ] **Step 7: テスト実行**

Run: `pnpm --filter conductor test src/config/schema.ts`
Expected: 全 test green

- [ ] **Step 8: Commit**

```bash
git add apps/conductor/src/config/schema.ts
git commit -m "refactor(conductor): build* return Result instead of throwing"
```

---

### Task 10: `config/parser.ts` の try/catch を削除

**Files:**
- Modify: `apps/conductor/src/config/parser.ts:6-44`

- [ ] **Step 1: parser.ts を Result 連鎖に簡略化**

ファイル全体 (in-source vitest を除く 1-44 行) を以下に置換:

```typescript
import { load as yamlLoad, YAMLException } from "js-yaml";
import type { Result } from "@praha/byethrow";
import type { ConfigError } from "../domain/config-errors.js";
import type { WorkflowConfig } from "../domain/workflow-config.js";
import { splitFrontmatter } from "./loader.js";
import { parseWorkflowYaml } from "./schema.js";

export const parseWorkflow = (
  path: string,
  raw: string,
): Result.Result<WorkflowConfig, ConfigError> => {
  const split = splitFrontmatter(path, raw);
  if (split.type === "Failure") return split;

  let yamlObject: unknown;
  try {
    yamlObject = yamlLoad(split.value.frontmatter);
  } catch (err) {
    const cause = err instanceof YAMLException ? err.message : String(err);
    return { type: "Failure", error: { kind: "yaml-parse-failed", path, cause } };
  }

  const parsed = parseWorkflowYaml(yamlObject);
  if (parsed.type === "Failure") {
    if (parsed.error.kind === "schema-violation") {
      return { type: "Failure", error: { kind: "schema-violation", path, issues: parsed.error.issues } };
    }
    return { type: "Failure", error: { kind: "invariant-violation", path, cause: parsed.error.cause } };
  }

  return {
    type: "Success",
    value: { ...parsed.value, prompt: split.value.body },
  };
};
```

- [ ] **Step 2: in-source vitest ブロック修正なし (公開 API 不変、Failure 種類も変わらない)**

- [ ] **Step 3: テスト実行**

Run: `pnpm --filter conductor test src/config`
Expected: 全 test green

- [ ] **Step 4: Commit**

```bash
git add apps/conductor/src/config/parser.ts
git commit -m "refactor(conductor): drop try/catch in parser; rely on Result chain"
```

---

## Phase D: `assertNever` で exhaustive switch (F6)

### Task 11: `cli/run.ts` format*Error 群に `assertNever`

**Files:**
- Modify: `apps/conductor/src/cli/run.ts:17-129`

- [ ] **Step 1: import 追加**

`run.ts` のトップに追加:

```typescript
import { assertNever } from "../util/assert-never.js";
```

- [ ] **Step 2: 各 format*Error に `default: return assertNever(...)` を追加**

`formatConfigError` (17-30 行):

```typescript
const formatConfigError = (err: ConfigError): string => {
  switch (err.kind) {
    case "file-not-found":
      return `workflow file not found: ${err.path}`;
    case "frontmatter-missing":
      return `workflow frontmatter (--- ... ---) missing: ${err.path}`;
    case "yaml-parse-failed":
      return `YAML parse failed in ${err.path}: ${err.cause}`;
    case "schema-violation":
      return `schema violation in ${err.path}: ${err.issues.map((i) => i.message).join("; ")}`;
    case "invariant-violation":
      return `workflow invariant violated in ${err.path}: ${err.cause}`;
    default:
      return assertNever(err);
  }
};
```

`formatBackendError` (32-49 行), `formatWorkspaceError` (51-62 行), `formatPromptError` (64-71 行), `formatTrackerError` (73-112 行), `formatOrchestratorError` (114-129 行) も同様に末尾へ `default: return assertNever(err);` を追加。

- [ ] **Step 3: テスト実行**

Run: `pnpm --filter conductor test src/cli`
Expected: 既存 test green (assertNever は到達しないので副作用なし)

- [ ] **Step 4: Commit**

```bash
git add apps/conductor/src/cli/run.ts
git commit -m "refactor(conductor): assertNever in cli format*Error switches"
```

---

### Task 12: `util/redact.ts`, `tracker/factory.ts`, `backend/factory.ts`, `config/schema.ts` に `assertNever`

**Files:**
- Modify: `apps/conductor/src/util/redact.ts:7-15`
- Modify: `apps/conductor/src/tracker/factory.ts:14-22`
- Modify: `apps/conductor/src/backend/factory.ts:8-17`
- Modify: `apps/conductor/src/config/schema.ts` (buildBackend / buildTracker の switch)

- [ ] **Step 1: `redact.ts` 更新**

```typescript
import { assertNever } from "./assert-never.js";
import type { WorkflowConfig } from "../domain/workflow-config.js";

const MASK = "*****";

export const redactConfig = (cfg: WorkflowConfig): WorkflowConfig => {
  const tracker = cfg.tracker;
  switch (tracker.kind) {
    case "linear":
      return { ...cfg, tracker: { ...tracker, apiKey: MASK } };
    case "github":
      return { ...cfg, tracker: { ...tracker, apiKey: MASK } };
    case "memory":
      return cfg;
    default:
      return assertNever(tracker);
  }
};
```

注: Phase J で `Sensitive<T>` 導入後この関数自体を削除予定。今は assertNever のみ。

- [ ] **Step 2: `tracker/factory.ts` 更新**

```typescript
import { assertNever } from "../util/assert-never.js";
// ...existing imports

export const createTracker = async (
  config: TrackerConfig,
  deps: { logger: Logger; fetch?: typeof globalThis.fetch },
): Promise<Result.Result<Tracker, TrackerError>> => {
  switch (config.kind) {
    case "memory":
      return { type: "Success", value: createMemoryTracker(config) };
    case "linear":
      return await createLinearTracker(config, deps);
    case "github":
      return await createGithubTracker(config, deps);
    default:
      return assertNever(config);
  }
};
```

- [ ] **Step 3: `backend/factory.ts` 更新**

```typescript
import { assertNever } from "../util/assert-never.js";
// ...existing imports

export const createBackend = (config: BackendConfig, logger: Logger): Backend => {
  switch (config.type) {
    case "claude":
      return createClaudeBackend(config, logger);
    case "codex":
      return createCodexBackend(config, logger);
    case "mock":
      return createMockBackend(config);
    default:
      return assertNever(config);
  }
};
```

- [ ] **Step 4: `config/schema.ts` の `buildBackend` / `buildTracker` switch に assertNever**

`buildBackend` の switch 末尾に:

```typescript
    default:
      return assertNever(yaml.agent);
```

注: `yaml.agent.type` で switch しているため `yaml.agent` を渡す。型は never 型に narrow される。

同様に `buildTracker` の switch 末尾に `default: return assertNever(yaml.tracker);` 追加。

- [ ] **Step 5: テスト実行**

Run: `pnpm --filter conductor test`
Expected: 全 test green

- [ ] **Step 6: Commit**

```bash
git add apps/conductor/src
git commit -m "refactor(conductor): assertNever in factory/redact/schema switches"
```

---

## Phase E: Function property notation (F4)

### Task 13: `Logger` / `Tracker` を function property notation に変更

**Files:**
- Modify: `apps/conductor/src/orchestrator/orchestrator.ts:11-15`
- Modify: `apps/conductor/src/tracker/types.ts:5-21`

- [ ] **Step 1: `Logger` を function property notation 化**

`orchestrator.ts:11-15`:

```typescript
export type Logger = Readonly<{
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (err: unknown) => void;
}>;
```

- [ ] **Step 2: `Tracker` を function property notation 化**

`tracker/types.ts:5-21`:

```typescript
export type Tracker = Readonly<{
  fetchCandidateIssues: () => Promise<Result.Result<ReadonlyArray<Issue>, TrackerError>>;
  fetchIssuesByStates: (
    states: ReadonlyArray<IssueStateName>,
  ) => Promise<Result.Result<ReadonlyArray<Issue>, TrackerError>>;
  fetchIssueStatesByIds: (
    ids: ReadonlyArray<IssueId>,
  ) => Promise<Result.Result<ReadonlyArray<Issue>, TrackerError>>;
  createComment: (
    issueId: IssueId,
    body: string,
  ) => Promise<Result.Result<void, TrackerError>>;
  updateIssueState: (
    issue: Issue,
    state: IssueStateName,
  ) => Promise<Result.Result<void, TrackerError>>;
}>;
```

- [ ] **Step 3: テスト実行**

Run: `pnpm --filter conductor test`
Expected: 全 test green (object literal 側はメソッド省略形でも function property を満たすので変更不要)

- [ ] **Step 4: Commit**

```bash
git add apps/conductor/src/orchestrator/orchestrator.ts apps/conductor/src/tracker/types.ts
git commit -m "refactor(conductor): Logger and Tracker use function property notation"
```

---

## Phase F: Memory tracker immutable 化 (F9)

### Task 14: `tracker/memory.ts` の MutableIssue を排除、map ベースに

**Files:**
- Modify: `apps/conductor/src/tracker/memory.ts:1-42`

- [ ] **Step 1: 既存テストを確認**

`memory.ts:70` の `updateIssueState mutates the internal store` テストは関数挙動 (Done 状態が読み戻せる) を見ているので、内部実装が immutable に変わっても同じ assertion が pass する。

- [ ] **Step 2: 実装を `let store: ReadonlyArray<Issue>` ベースに書き直し**

`memory.ts` の 1-42 行 (in-source vitest 開始まで) を以下に置換:

```typescript
import type { Result } from "@praha/byethrow";
import type { MemoryTrackerConfig } from "../domain/tracker-config.js";
import type { Issue, IssueId, IssueStateName } from "../domain/issue.js";
import type { TrackerError } from "../domain/tracker-errors.js";
import type { Tracker } from "./types.js";

const normalize = (s: string): string => s.trim().toLowerCase();

export const createMemoryTracker = (config: MemoryTrackerConfig): Tracker => {
  // Immutable snapshot; updateIssueState rebuilds the array via map.
  let store: ReadonlyArray<Issue> = config.issues.map((i) => ({ ...i }));

  const ok = <T>(value: T): Result.Result<T, TrackerError> => ({ type: "Success", value });

  return {
    fetchCandidateIssues: async () => ok(store.map((i) => ({ ...i }))),
    fetchIssuesByStates: async (states) => {
      const wanted = new Set(states.map(normalize));
      return ok(
        store.filter((i) => wanted.has(normalize(i.state))).map((i) => ({ ...i })),
      );
    },
    fetchIssueStatesByIds: async (ids) => {
      const wanted = new Set(ids);
      return ok(store.filter((i) => wanted.has(i.id)).map((i) => ({ ...i })));
    },
    createComment: async () => ok(undefined),
    updateIssueState: async (issue, state) => {
      const idx = store.findIndex((i) => i.id === issue.id);
      if (idx < 0) {
        return { type: "Failure", error: { kind: "issue-not-found", id: issue.id } };
      }
      store = store.map((i) => (i.id === issue.id ? { ...i, state } : i));
      return ok(undefined);
    },
  };
};
```

- [ ] **Step 3: テスト実行**

Run: `pnpm --filter conductor test src/tracker/memory.ts`
Expected: 全 test green

- [ ] **Step 4: Commit**

```bash
git add apps/conductor/src/tracker/memory.ts
git commit -m "refactor(conductor): memory tracker stores ReadonlyArray; mutation via map"
```

---

## Phase G: `p:any` 排除 (F10)

### Task 15: Standard Schema path narrowing helper を追加し、`p:any` を全置換

**Files:**
- Create: `apps/conductor/src/util/schema-issue.ts`
- Modify: `apps/conductor/src/tracker/linear/client.ts:86`
- Modify: `apps/conductor/src/tracker/github/client.ts:92`
- Modify: `apps/conductor/src/config/schema.ts:364`

- [ ] **Step 1: 共通 helper を作成**

`apps/conductor/src/util/schema-issue.ts`:

```typescript
import type { StandardSchemaV1 } from "@standard-schema/spec";

/** Standard Schema's PathItem can be a raw PropertyKey or an object `{ key }`.
 *  Normalise both forms to a string segment for log/error messages. */
const segmentToString = (segment: unknown): string => {
  if (typeof segment === "string" || typeof segment === "number" || typeof segment === "symbol") {
    return String(segment);
  }
  if (typeof segment === "object" && segment !== null && "key" in segment) {
    return String((segment as { key: unknown }).key);
  }
  return "<unknown>";
};

/** Format the `.path` of a `StandardSchemaV1.Issue` as a dotted string, or
 *  `<root>` if path is absent. */
export const formatIssuePath = (issue: StandardSchemaV1.Issue): string =>
  issue.path && issue.path.length > 0
    ? issue.path.map(segmentToString).join(".")
    : "<root>";

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("util/schema-issue", () => {
    it("formats path with string segments", () => {
      expect(formatIssuePath({ message: "x", path: ["a", "b"] } as any)).toBe("a.b");
    });
    it("formats path with object key segments", () => {
      expect(formatIssuePath({ message: "x", path: [{ key: "a" }, { key: "b" }] } as any)).toBe("a.b");
    });
    it("returns <root> for empty/missing path", () => {
      expect(formatIssuePath({ message: "x" } as any)).toBe("<root>");
      expect(formatIssuePath({ message: "x", path: [] } as any)).toBe("<root>");
    });
  });
}
```

- [ ] **Step 2: `linear/client.ts:85-87` を helper 経由に**

```typescript
import { formatIssuePath } from "../../util/schema-issue.js";
// ...

  if (!parsed.success) {
    const issues = parsed.issues.map((i) => `${formatIssuePath(i)}: ${i.message}`);
    return { type: "Failure", error: { kind: "linear-response-invalid", issues } };
  }
```

- [ ] **Step 3: `github/client.ts:91-93` を helper 経由に (同パターン)**

```typescript
import { formatIssuePath } from "../../util/schema-issue.js";
// ...
  if (!parsed.success) {
    const issues = parsed.issues.map((i) => `${formatIssuePath(i)}: ${i.message}`);
    return { type: "Failure", error: { kind: "github-response-invalid", issues } };
  }
```

- [ ] **Step 4: `config/schema.ts:364` test の `p: any` を helper 経由に**

```typescript
    it("rejects hooks nested under workspace (Phase 1 buggy shape)", () => {
      // ...existing setup
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Failure") throw new Error("expected schema failure");
      if (r.error.kind !== "schema-violation") throw new Error("expected schema-violation");
      const paths = r.error.issues.map((i) => formatIssuePath(i));
      expect(paths.some((p) => /workspace/.test(p))).toBe(true);
    });
```

import: `import { formatIssuePath } from "../util/schema-issue.js";`

- [ ] **Step 5: テスト実行**

Run: `pnpm --filter conductor test`
Expected: 全 test green、`p: any` の grep が production スコープでゼロ件:

```bash
grep -n "p: any\|p:any" apps/conductor/src/tracker apps/conductor/src/config -r | grep -v "vitest" | grep -v "describe\|expect\|it("
```

- [ ] **Step 6: Commit**

```bash
git add apps/conductor/src/util/schema-issue.ts apps/conductor/src/tracker apps/conductor/src/config
git commit -m "refactor(conductor): formatIssuePath helper replaces 'p: any' callbacks"
```

---

## Phase H: Test fixture cleanup (F13/F14)

### Task 16: branded ID の test `as any` を `v.parse` 置換

**Files:**
- Modify: `apps/conductor/src/tracker/linear/adapter.ts:409`
- Modify: `apps/conductor/src/tracker/github/adapter.ts:716,740,768,780`
- Modify: `apps/conductor/src/workspace/hooks.ts:166-176`

- [ ] **Step 1: linear/adapter.ts:409 を v.parse 化**

```typescript
      const out = await r.value.fetchIssueStatesByIds([
        v.parse(IssueId.schema, "a"),
        v.parse(IssueId.schema, "b"),
        v.parse(IssueId.schema, "c"),
      ]);
```

- [ ] **Step 2: github/adapter.ts:716, 740 を v.parse 化**

```typescript
      const out = await r.value.fetchIssueStatesByIds([
        v.parse(IssueId.schema, "I_1"),
        v.parse(IssueId.schema, "I_2"),
        v.parse(IssueId.schema, "I_3"),
      ]);
```

(`:740` の `fetchIssueStatesByIds(["I_1" as any, "I_2" as any])` も同様に)

- [ ] **Step 3: github/adapter.ts:768, 780 (createComment) を v.parse 化**

```typescript
      const c = await r.value.createComment(v.parse(IssueId.schema, "I_1"), "hello");
```

- [ ] **Step 4: `workspace/hooks.ts:166-176` buildHookEnv テストを v.parse 化**

```typescript
    it("buildHookEnv extracts issue fields", async () => {
      const v = await import("valibot");
      const { IssueId, IssueIdentifier, IssueStateName } = await import("../domain/issue.js");
      const e = buildHookEnv({
        id: v.parse(IssueId.schema, "X-1"),
        identifier: v.parse(IssueIdentifier.schema, "X-1"),
        title: "T",
        description: "",
        state: v.parse(IssueStateName.schema, "Todo"),
      });
      expect(e.ISSUE_ID).toBe("X-1");
      expect(e.ISSUE_TITLE).toBe("T");
    });
```

- [ ] **Step 5: テスト実行**

Run: `pnpm --filter conductor test`
Expected: 全 test green

- [ ] **Step 6: Commit**

```bash
git add apps/conductor/src/tracker apps/conductor/src/workspace
git commit -m "test(conductor): replace branded-ID 'as any' with v.parse in tests"
```

---

### Task 17: 残る `as any` (Mock fetch / `as unknown as typeof globalThis.fetch`) を整理

vitest 内の `fetchFn as unknown as typeof globalThis.fetch` は test mock の boundary なので許容。`(fetchFn as any).mock.calls.length` は vitest API 互換のため許容。本タスクでは production スコープに `as any` が残っていないことのみ確認する。

- [ ] **Step 1: 残る `as any` を列挙**

Run:

```bash
grep -rn "as any" apps/conductor/src | grep -v "describe\|expect\|it(\|.mock.calls"
```

Expected output: vitest 内の fixture mock のみ (`} as any;` で `Tracker`-like を作っているケース、`firstAssigneeLogin({ nodes: [] } as any)` など)。

- [ ] **Step 2: production スコープに残っていれば修正、なければスキップ**

production スコープ (vitest ブロック外) は Phase B/G で全て消えているはず。test fixture の `{} as any` で `Tracker` を組んでいる箇所 (`orchestrator.ts:123`, `agent-runner.ts:243,277,314,344,376`) はインタフェース複雑度の都合で残しても構わないが、Phase E の function property 化 + Task 13 後にコンパイル可能になっていれば、`as any` を外して `as Tracker` に置換できるはず。試して compile error が出る箇所のみ `as any` 維持。

各テストファイルで `} as any;` → `} as Tracker;` 置換を試行:

```bash
sed -i 's/} as any;$/} as Tracker;/' apps/conductor/src/orchestrator/orchestrator.ts apps/conductor/src/orchestrator/agent-runner.ts
```

注: sed 後に `pnpm --filter conductor test` を走らせ、コンパイルエラーが出たら手動で revert。

- [ ] **Step 3: テスト実行**

Run: `pnpm --filter conductor test`
Expected: 全 test green

- [ ] **Step 4: Commit**

```bash
git add apps/conductor/src
git commit -m "test(conductor): tighten Tracker mocks with explicit type"
```

---

### Task 18: in-source vitest fixture を `as const satisfies` 化

**Files:**
- Modify: 各 in-source `import.meta.vitest` ブロック内の fixture (`: Issue =` パターン)

- [ ] **Step 1: 対象 fixture を列挙**

主要対象 (`const issue: Issue = {...}` パターン):
- `apps/conductor/src/backend/mock.ts:34`
- `apps/conductor/src/backend/jsonrpc/messages.ts` (該当なし)
- `apps/conductor/src/orchestrator/orchestrator.ts:107`
- `apps/conductor/src/orchestrator/agent-runner.ts:205-212,270,307`
- `apps/conductor/src/prompt/builder.ts:52-58`
- `apps/conductor/src/workspace/manager.ts:67-73`
- `apps/conductor/src/tracker/linear/adapter.ts:302-308`
- `apps/conductor/src/tracker/github/adapter.ts:787-801`

- [ ] **Step 2: 例: `backend/mock.ts:34-40` を `as const satisfies`**

before:
```typescript
  const issue = {
    id: v.parse(IssueId.schema, "M-1"),
    identifier: v.parse(IssueIdentifier.schema, "M-1"),
    title: "t",
    description: "",
    state: v.parse(IssueStateName.schema, "Todo"),
  };
```

after (型注釈ありなしを問わず `as const satisfies`):
```typescript
  const issue = {
    id: v.parse(IssueId.schema, "M-1"),
    identifier: v.parse(IssueIdentifier.schema, "M-1"),
    title: "t",
    description: "",
    state: v.parse(IssueStateName.schema, "Todo"),
  } as const satisfies Issue;
```

- [ ] **Step 3: 各 fixture を順次置換**

`const X: Type = { ... };` のパターンを:

```typescript
const X = { ... } as const satisfies Type;
```

に置換。`Issue` 型 import が必要なら明示 import。

注: `agent-runner.ts:212` の `const doneIssue: Issue = { ...issue, state: ... };` のような spread 派生は `as const satisfies Issue` でも spread element が widening するため、必要に応じて元の `: Issue` 注釈に戻す (代わりに親 `issue` 側で as const satisfies しておけば派生も狭まる)。動作テストでコンパイル可否を確認。

- [ ] **Step 4: テスト実行**

Run: `pnpm --filter conductor test`
Expected: 全 test green

- [ ] **Step 5: Commit**

```bash
git add apps/conductor/src
git commit -m "test(conductor): in-source fixtures use 'as const satisfies'"
```

---

## Phase I: Sensitive<T> for apiKey (S1)

### Task 19: `LinearTrackerConfig.apiKey` / `GithubTrackerConfig.apiKey` を `Sensitive<string>` 化

**Files:**
- Modify: `apps/conductor/src/domain/tracker-config.ts:16-33`
- Modify: `apps/conductor/src/config/schema.ts` (buildTracker)
- Modify: `apps/conductor/src/tracker/linear/client.ts:45`
- Modify: `apps/conductor/src/tracker/github/client.ts:44`
- Modify: `apps/conductor/src/tracker/linear/adapter.ts` (clientDeps)
- Modify: `apps/conductor/src/tracker/github/adapter.ts` (clientDeps)
- Modify: `apps/conductor/src/util/redact.ts` → 削除
- Modify: `apps/conductor/src/cli/run.ts` (`redactConfig` 呼び出し削除)

- [ ] **Step 1: `tracker-config.ts` の apiKey 型を `Sensitive<string>` に**

16-33 行:

```typescript
import type { Sensitive } from "../util/sensitive.js";

// ...existing types

export type LinearTrackerConfig = TrackerCommon &
  Readonly<{
    kind: "linear";
    apiKey: Sensitive<string>;
    endpoint?: string;
    projectSlug: string;
    assignee?: string;
  }>;

export type GithubTrackerConfig = TrackerCommon &
  Readonly<{
    kind: "github";
    apiKey: Sensitive<string>;
    endpoint?: string;
    projectOwner: string;
    projectNumber: number;
    assignee?: string;
  }>;
```

`tracker-config.ts` vitest ブロックの fixture も `Sensitive.of(...)` に置換:

```typescript
    it("composes a linear tracker", () => {
      const cfg: TrackerConfig = {
        kind: "linear",
        activeStates: ["Todo"],
        terminalStates: ["Done"],
        apiKey: Sensitive.of("lin_xxx"),
        projectSlug: "concert-xxx",
      };
      expect(cfg.kind).toBe("linear");
    });

    it("composes a github tracker", () => {
      const cfg: TrackerConfig = {
        kind: "github",
        activeStates: ["Todo"],
        terminalStates: ["Done"],
        apiKey: Sensitive.of("ghp_xxx"),
        projectOwner: "babie",
        projectNumber: 1,
      };
      expect(cfg.kind).toBe("github");
    });
```

import: `import { Sensitive } from "../util/sensitive.js";`

- [ ] **Step 2: `config/schema.ts` `buildTracker` で `Sensitive.of` ラップ**

Task 9 で書き直した buildTracker の linear / github ブロックで:

```typescript
      const out: LinearTrackerConfig = {
        kind: "linear",
        ...common,
        apiKey: Sensitive.of(apiKeyR.value),
        // ...
      };
```

同じく github ブロックも `apiKey: Sensitive.of(apiKeyR.value)`。

import を追加: `import { Sensitive } from "../util/sensitive.js";`

- [ ] **Step 3: `linear/client.ts:45` で `.reveal()`**

```typescript
        Authorization: deps.apiKey.reveal(),
```

`LinearClientDeps` 型の apiKey も `Sensitive<string>` に:

```typescript
export type LinearClientDeps = Readonly<{
  endpoint: string;
  apiKey: Sensitive<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}>;
```

import: `import { Sensitive } from "../../util/sensitive.js";`

vitest 内の test deps fixture (`apiKey: "lin_test"`) も `apiKey: Sensitive.of("lin_test")` に。

- [ ] **Step 4: `github/client.ts:44` も同様に `.reveal()` + 型を `Sensitive<string>`**

```typescript
        Authorization: `Bearer ${deps.apiKey.reveal()}`,
```

`GithubClientDeps` 型も `apiKey: Sensitive<string>`、vitest 内 fixture も `Sensitive.of(...)`。

- [ ] **Step 5: linear/adapter.ts と github/adapter.ts の clientDeps 構築箇所**

`linear/adapter.ts:206`:

```typescript
  const clientDeps: LinearClientDeps = {
    endpoint: config.endpoint ?? DEFAULT_LINEAR_ENDPOINT,
    apiKey: config.apiKey,  // already Sensitive<string> from config
    // ...
  };
```

config.apiKey は既に `Sensitive<string>` なのでそのまま渡せる。`as` 不要。

`github/adapter.ts:296` も同じ。

- [ ] **Step 6: `util/redact.ts` を削除**

```bash
rm apps/conductor/src/util/redact.ts
```

- [ ] **Step 7: `cli/run.ts:7,155` の redactConfig 参照を削除**

import 削除:

```typescript
// REMOVE: import { redactConfig } from "../util/redact.js";
```

155 行を:

```typescript
    logger.error(`config (apiKey auto-masked): ${JSON.stringify(config)}`);
```

JSON.stringify が Sensitive の toJSON 経由で自動マスクするので redact 関数不要。

- [ ] **Step 8: テスト実行**

Run: `pnpm --filter conductor test`
Expected: 全 test green

- [ ] **Step 9: Commit**

```bash
git add apps/conductor/src
git commit -m "feat(conductor): wrap tracker apiKey in Sensitive<string>; drop redactConfig"
```

---

## Phase J: byethrow Result.pipe 限定リファクタ (F15 部分)

### Task 20: `linear/adapter.ts` `updateStateWithRetry` を `Result.pipe` 化

**Files:**
- Modify: `apps/conductor/src/tracker/linear/adapter.ts:173-198`

- [ ] **Step 1: retry helper を抜き出して pipe で組む**

`updateStateWithRetry` を以下に書き直し:

```typescript
import { Result } from "@praha/byethrow";
// ...existing imports

const retryUpdateState = async (
  clientDeps: LinearClientDeps,
  issueId: string,
  stateId: string,
  logger: Logger,
  issueIdentifier: string,
): Promise<Result.Result<void, TrackerError>> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await doUpdateState(clientDeps, issueId, stateId);
    if (r.type === "Success") return r;
    if (attempt < RETRY_DELAYS_MS.length) {
      logger.info(
        `[linear] updateIssueState retry ${attempt + 1}/3 after ${RETRY_DELAYS_MS[attempt]}ms (issue=${issueIdentifier})`,
      );
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }
  logger.warn(
    `[linear] updateIssueState failed after 3 attempts (issue=${issueIdentifier}); continuing best-effort per ADR-0014`,
  );
  return { type: "Success", value: undefined };
};

/** 3-attempt retry (250ms, 1s) → best-effort ok(undefined) + warn log on final failure.
 *  Per ADR-0014, transient mutation failures must not abort agent execution. */
const updateStateWithRetry = (
  clientDeps: LinearClientDeps,
  logger: Logger,
  issue: Issue,
  stateName: string,
): Promise<Result.Result<void, TrackerError>> =>
  Result.pipe(
    resolveStateId(clientDeps, issue.id, stateName),
    Result.andThen((stateId) =>
      retryUpdateState(clientDeps, issue.id, stateId, logger, issue.identifier),
    ),
  );
```

- [ ] **Step 2: テスト実行 (既存テストが pipe 化後も pass することを確認)**

Run: `pnpm --filter conductor test src/tracker/linear/adapter.ts`
Expected: 全 test green

- [ ] **Step 3: Commit**

```bash
git add apps/conductor/src/tracker/linear/adapter.ts
git commit -m "refactor(conductor): linear updateStateWithRetry uses Result.pipe + andThen"
```

---

### Task 21: `github/adapter.ts` `updateStateWithRetry` を `Result.pipe` 化

**Files:**
- Modify: `apps/conductor/src/tracker/github/adapter.ts:247-290`

- [ ] **Step 1: 同パターンで pipe 化**

`updateStateWithRetry` を以下に置換:

```typescript
import { Result } from "@praha/byethrow";
// ...existing imports

const resolveStatusOption = (
  meta: GithubProjectMeta,
  issue: Issue,
  stateName: string,
): Result.Result<{ projectId: string; itemId: string; optionId: string }, TrackerError> => {
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
  return {
    type: "Success",
    value: { projectId: issue.extra.projectId, itemId: issue.extra.projectItemId, optionId },
  };
};

const retryUpdateItemStatus = async (
  clientDeps: GithubClientDeps,
  fieldId: string,
  vars: { projectId: string; itemId: string; optionId: string },
  logger: Logger,
  issueIdentifier: string,
): Promise<Result.Result<void, TrackerError>> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await doUpdateItemStatus(clientDeps, { fieldId, ...vars });
    if (r.type === "Success") return r;
    if (attempt < RETRY_DELAYS_MS.length) {
      logger.info(
        `[github] updateIssueState retry ${attempt + 1}/3 after ${RETRY_DELAYS_MS[attempt]}ms (issue=${issueIdentifier})`,
      );
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }
  logger.warn(
    `[github] updateIssueState failed after 3 attempts (issue=${issueIdentifier}); continuing best-effort per ADR-0014`,
  );
  return { type: "Success", value: undefined };
};

const updateStateWithRetry = (
  clientDeps: GithubClientDeps,
  meta: GithubProjectMeta,
  logger: Logger,
  issue: Issue,
  stateName: string,
): Promise<Result.Result<void, TrackerError>> =>
  Result.pipe(
    resolveStatusOption(meta, issue, stateName),
    Result.andThen((vars) =>
      retryUpdateItemStatus(clientDeps, meta.statusFieldId, vars, logger, issue.identifier),
    ),
  );
```

- [ ] **Step 2: テスト実行**

Run: `pnpm --filter conductor test src/tracker/github/adapter.ts`
Expected: 全 test green (`returns github-no-project-item` / `returns github-status-option-not-found` の no-retry テストも変わらず pass)

- [ ] **Step 3: Commit**

```bash
git add apps/conductor/src/tracker/github/adapter.ts
git commit -m "refactor(conductor): github updateStateWithRetry uses Result.pipe + andThen"
```

---

### Task 22: `apps/conductor/CLAUDE.md` に pipe 推奨ガイドライン追記

**Files:**
- Modify: `apps/conductor/CLAUDE.md` (「設計指針 (kamae 準拠)」セクション)

- [ ] **Step 1: 設計指針セクションに 1 行追記**

37-44 行のリスト末尾に:

```markdown
- discriminated unions + branded types (Companion Object + `v.brand()`) で domain modeling
- boundary（WORKFLOW.md ロード、tracker API、backend stdio）で valibot 検証
- 全 boundary 関数は `Result<T, E>`（byethrow）。throw は最終手段
- `linear.api_key` / `github.api_key` 等の PII は `Sensitive<T>` で wrap (boundary で auto-mask)
- **新規コードは `Result.pipe(...Result.andThen|bind|map...)` で連鎖**。手動 `if (r.type === "Failure") return r;` は新規では避ける (既存コードは漸次置換)
- 1 file = 1 module。`orchestrator.ex` (1,826 行) のような巨大ファイルは作らない
```

注: S1 で `util/redact.ts` を消したので「`util/redact.ts` で `*****`」は `Sensitive<T>` 表現に差し替え済み。

- [ ] **Step 2: Commit**

```bash
git add apps/conductor/CLAUDE.md
git commit -m "docs(conductor): adopt Result.pipe and Sensitive<T> as new-code guidelines"
```

---

## Phase K: type vs kind deviation コメント (F11)

### Task 23: `backend-config.ts` に deviation コメント追加

**Files:**
- Modify: `apps/conductor/src/domain/backend-config.ts:1`

- [ ] **Step 1: ファイル先頭にコメントブロック追加**

`backend-config.ts` の 1 行目に挿入:

```typescript
// NOTE: This file uses `type` (not `kind`) as the discriminant intentionally,
// because the YAML schema (`agent.type: "claude" | "codex" | "mock"`) is the
// user-facing contract and we want a 1:1 mapping between YAML and TS shapes.
// Codex's `turn_sandbox_policy` payload (sent over JSON-RPC) also uses `type`,
// so swapping in `kind` would force a translation layer on both ends.
//
// See TODO.md (M4+) for the plan to unify on `kind` across the codebase.

export type ClaudeBackend = Readonly<{
  type: "claude";
  command: string;
}>;
// ...existing types
```

- [ ] **Step 2: Commit**

```bash
git add apps/conductor/src/domain/backend-config.ts
git commit -m "docs(conductor): document 'type' discriminant deviation in backend-config"
```

---

## Phase L: TODO.md に M4+ 候補追記

### Task 24: TODO.md に F11 全面リネームと F15 全面 pipe 化を追記

**Files:**
- Modify: `TODO.md` (「Milestone 4 以降」セクション)

- [ ] **Step 1: M4+ セクション末尾に 2 項目追加**

`TODO.md:120` の `## apps/composer` の前に挿入:

```markdown
## BackendConfig 系の discriminant を `kind` に統一

- 現状: `BackendConfig` / `Backend` / `BackendSession` / `turnSandboxPolicy` などが `type` を discriminant に使用 (kamae 慣習は `kind`)
- `apps/conductor/src/domain/backend-config.ts` のヘッダコメントで deviation を明記済み
- YAML 互換性は維持しつつ、TS 側のみ `kind` に揃える方向で検討
- 影響範囲: WORKFLOW.md パーサ (YAML → TS 変換層で `type` → `kind` マッピング)、`backend/factory.ts`、`backend/jsonrpc/messages.ts` の Codex sandbox policy

## tracker adapter 全体を `Result.pipe` で書き直す

- 現状: `updateStateWithRetry` のみ pipe 化 (`linear/adapter.ts`、`github/adapter.ts`)
- 残り: `fetchCandidateIssues` / `fetchIssuesByIds` / `fetchIssueStatesByIds` / `createComment` などの `if (r.type === "Failure") return r;` 連鎖
- 目標: byethrow ガイドの Railway Oriented Programming スタイルへ全面移行
- 副産物として helper 関数の curry 化が進み、unit test しやすくなる想定
```

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs: add M4+ items for kind unification and Result.pipe full adoption"
```

---

## Phase M: 最終検証

### Task 25: 全 test + lint + build を回す

- [ ] **Step 1: テスト全数**

Run: `pnpm --filter conductor test`
Expected: 全 test green

- [ ] **Step 2: oxlint**

Run: `pnpm --filter conductor lint`
Expected: 0 error

- [ ] **Step 3: tsc build**

Run: `pnpm --filter conductor build`
Expected: 0 error, `dist/bin.js` 生成

- [ ] **Step 4: production `as any` ゼロ確認**

Run:

```bash
grep -rn "as any" apps/conductor/src --include="*.ts" | grep -v "import.meta.vitest\|describe\|expect\|it(\|.mock.calls"
```

Expected: 0 行 (vitest fixture 内のもののみ残ることはあり、その場合は手動確認)

- [ ] **Step 5: production `p: any` ゼロ確認**

Run:

```bash
grep -rn "p: any\|p:any" apps/conductor/src --include="*.ts"
```

Expected: 0 行

- [ ] **Step 6: kamae-review 再走 (optional, recommended)**

`/kamae-review apps/conductorをレビューして` を実行し、High/Medium 件数が減ったことを確認。

- [ ] **Step 7: 何もなければマージ準備完了**

```bash
git log --oneline main..HEAD
```

Commit 数を確認 (期待: 約 22 commits)。

---

## Self-Review

**Spec coverage check:**

- F1 (`(fv as any)` in `github/adapter.ts`) → Task 4, 5 ✓
- F2 (`(item.content as any).assignees`) → Task 7 ✓
- F3 (`(node as any).name` in `project-meta.ts`) → Task 6 ✓
- F4 (Logger / Tracker method notation) → Task 13 ✓
- F5 (`config/schema.ts` throw → Result) → Task 9, 10 ✓
- F6 (assertNever 不在) → Task 11, 12 ✓
- F7 (`domain/errors.ts` 分割) → Task 3 ✓
- F8 (`raw as IssueByIdNode`) → Task 7 ✓
- F9 (memory tracker MutableIssue) → Task 14 ✓
- F10 (`p: any` ) → Task 15 ✓
- F11 (type/kind 混在) → Task 23 (deviation コメント) + Task 24 (M4+) ✓
- F12 (命令的 for ループ) → 部分対応: extractStatusRaw 等は Task 5 で副次的に書き直し。filterAndNormalize の filter/map 化は Task 7 で取り扱い済み。pagination loop は M4+ に送る (TODO.md 既掲載「tracker adapter 全体を Result.pipe で書き直す」に内包) ✓
- F13 (`as const satisfies`) → Task 18 ✓
- F14 (test branded `as any`) → Task 16 ✓
- F15 (byethrow pipe) → Task 20, 21 (代表 2 箇所) + Task 22 (ガイドライン) + Task 24 (全面化を M4+) ✓
- S1 (Sensitive<T>) → Task 2 + Task 19 ✓

**Placeholder scan:** 全ステップに具体的なコード／コマンド／expected 行を記載済み。"TBD" / "implement later" 含めず。

**Type consistency:**
- `Sensitive<T>` 型シグネチャは Task 2 で確定、Task 19 で利用。consistent ✓
- `WorkflowYamlError` は Task 9 で導入、Task 10 で消費。consistent ✓
- `assertNever` シグネチャは Task 1 で確定、Task 11/12 で利用。consistent ✓
- `formatIssuePath` は Task 15 で導入、3 箇所で利用。consistent ✓
- `IssueContentNarrowed` 型エイリアス名は Task 7 内で 2 箇所参照、consistent ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-kamae-review-fixes.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Phase 単位で並列実行できる箇所 (例: Phase D の Task 11/12 は独立) はバッチ化する想定。

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

どちらで進めますか?
