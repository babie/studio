# M4 Rebranding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand `babie/concert` monorepo to `babie/studio` via fresh-repo migration, renaming `apps/conductor` → `apps/perform`, archiving the old repo as `babie/concert-archive` (private), and excluding third-party `docs/vendor/*` from public history.

**Architecture:** Three phases — (4a) agent renames everything in the old DevContainer on a feature branch, (4b) user runs cutover commands across GitHub / macOS / OrbStack, (4c) agent verifies the new DevContainer is green. Detailed rationale and rollback procedures live in [`docs/superpowers/specs/2026-05-18-m4-rebranding-design.md`](../specs/2026-05-18-m4-rebranding-design.md).

**Tech Stack:** pnpm workspaces, TypeScript (vitest, valibot, byethrow, commander), git, gh CLI, Docker (OrbStack), DevPod, DevContainer

---

## Phase 4a: Rename & content cleanup (Agent in old DevContainer)

All Phase 4a tasks run in the existing `babie/concert` DevContainer at `/workspace`, on a new branch `feat/m4-rebranding`. **Do not push** this branch — the work lands in `babie/studio` via `rsync` in Phase 4b.

---

### Task 1: Create feature branch and verify baseline green

**Files:**
- Modify: (git only)

- [ ] **Step 1: Confirm clean working tree**

```bash
cd /workspace
git status
```

Expected: `nothing to commit, working tree clean` on `main`.

- [ ] **Step 2: Create feature branch**

```bash
git switch -c feat/m4-rebranding
```

Expected: `Switched to a new branch 'feat/m4-rebranding'`.

- [ ] **Step 3: Baseline install**

```bash
pnpm install
```

Expected: completes without error; `node_modules` populated.

- [ ] **Step 4: Baseline build**

```bash
pnpm build
```

Expected: PASS (claude-app-server + conductor both build).

- [ ] **Step 5: Baseline test**

```bash
pnpm test
```

Expected: PASS (all vitest suites green). This is the regression baseline.

---

### Task 2: Rename `apps/conductor` → `apps/perform`

**Files:**
- Move: `apps/conductor/**` → `apps/perform/**`

- [ ] **Step 1: Rename via git mv**

```bash
git mv apps/conductor apps/perform
```

Expected: no output. Verify with `git status` — should show many renames.

- [ ] **Step 2: Refresh workspace lockfile**

```bash
pnpm install
```

Expected: pnpm picks up the new path; `pnpm-lock.yaml` may update. Build will fail at this point because `package.json` still says `name: "conductor"` and root scripts still reference `--filter conductor` — that's intentional, fixed in next tasks.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename apps/conductor → apps/perform

Pure directory rename. Subsequent commits update package metadata, scripts,
and source references."
```

---

### Task 3: Update `apps/perform/package.json` metadata

**Files:**
- Modify: `apps/perform/package.json`

- [ ] **Step 1: Edit `name` and `bin`**

Change in `apps/perform/package.json`:

```diff
-  "name": "conductor",
+  "name": "perform",
   "version": "0.1.0",
   "private": true,
   "license": "Apache-2.0",
   "type": "module",
   "bin": {
-    "conductor": "./dist/bin.js"
+    "perform": "./dist/bin.js"
   },
```

- [ ] **Step 2: Refresh workspace**

```bash
pnpm install
```

Expected: pnpm re-links the workspace with the new package name.

- [ ] **Step 3: Commit**

```bash
git add apps/perform/package.json pnpm-lock.yaml
git commit -m "refactor(perform): rename package and binary"
```

---

### Task 4: Update root `package.json` scripts and name

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Edit root package.json**

Apply this exact diff to `/workspace/package.json`:

```diff
   "name": "concert",
+  "name": "studio",
   ...
   "scripts": {
-    "build": "pnpm build:claude-app-server && pnpm build:conductor",
+    "build": "pnpm build:claude-app-server && pnpm build:perform",
     "build:claude-app-server": "pnpm --filter claude-app-server build",
-    "build:conductor": "pnpm --filter conductor build",
+    "build:perform": "pnpm --filter perform build",
-    "test": "pnpm test:claude-app-server && pnpm test:conductor",
+    "test": "pnpm test:claude-app-server && pnpm test:perform",
     "test:claude-app-server": "pnpm --filter claude-app-server test",
-    "test:conductor": "pnpm --filter conductor test",
+    "test:perform": "pnpm --filter perform test",
     "test:e2e": "pnpm --filter e2e test:setup && pnpm --filter e2e test",
     "test:e2e:claude-linear": "pnpm --filter e2e test:claude-linear",
     "test:e2e:claude-github": "pnpm --filter e2e test:claude-github",
-    "dev:install": "cd apps/claude-app-server && pnpm link --global && cd ../conductor && pnpm link --global",
+    "dev:install": "cd apps/claude-app-server && pnpm link --global && cd ../perform && pnpm link --global",
-    "dev:uninstall": "pnpm uninstall -g claude-app-server || true; pnpm uninstall -g conductor || true"
+    "dev:uninstall": "pnpm uninstall -g claude-app-server || true; pnpm uninstall -g perform || true"
   },
```

- [ ] **Step 2: Verify build now succeeds**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Verify tests still pass**

```bash
pnpm test
```

Expected: PASS. Some test names referencing "conductor" may still appear — that's fine, addressed in Task 5.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(repo): update root package name and scripts for perform"
```

---

### Task 5: Sweep `apps/perform/src/` internal references

**Files:**
- Modify: `apps/perform/src/bin.ts`
- Modify: `apps/perform/src/cli/run.ts`
- Modify: `apps/perform/src/backend/jsonrpc/transport.ts` (test name)
- Possibly modify: other files containing literal "conductor" / "Conductor" / "concert"

- [ ] **Step 1: Audit conductor references in src**

```bash
git grep -n -E "conductor|Conductor|concert" apps/perform/src/
```

Expected output (key hits):
- `apps/perform/src/bin.ts`: `.name("conductor")`, `.description("Conductor — ...")`, `--accept-orchestrator-risk` flag help
- `apps/perform/src/cli/run.ts`: log message `conductor runs agents without per-tool prompts`, test fixture `"babie/concert#1"`
- `apps/perform/src/backend/jsonrpc/transport.ts:172`: `it("captures writes from conductor", ...)`
- Other comments / log messages

- [ ] **Step 2: Update `bin.ts`**

Edit `apps/perform/src/bin.ts`:

```diff
-  .name("conductor")
+  .name("perform")
-  .description("Conductor — agent orchestrator for memory/linear/github trackers")
+  .description("Perform — agent orchestrator for memory/linear/github trackers")
   .version("0.1.0")
   .argument("<workflow>", "path to WORKFLOW.md")
-  .option(GUARDRAIL_FLAG, "acknowledge that conductor runs agents without per-tool prompts")
+  .option(GUARDRAIL_FLAG, "acknowledge that perform runs agents without per-tool prompts")
```

- [ ] **Step 3: Update `cli/run.ts`**

Find the error message at line ~172:

```diff
-    earlyLogger.error(`Refusing to start. Pass ${GUARDRAIL_FLAG} to acknowledge that conductor runs agents without per-tool prompts.`);
+    earlyLogger.error(`Refusing to start. Pass ${GUARDRAIL_FLAG} to acknowledge that perform runs agents without per-tool prompts.`);
```

Find the test fixture at line ~300:

```diff
-      [{ kind: "github-no-project-item", issueIdentifier: "babie/concert#1" }, /issue babie\/concert#1/],
+      [{ kind: "github-no-project-item", issueIdentifier: "babie/studio#1" }, /issue babie\/studio#1/],
```

- [ ] **Step 4: Update vitest test name in `transport.ts`**

```diff
-    it("captures writes from conductor", () => {
+    it("captures writes from perform", () => {
```

- [ ] **Step 5: Sweep remaining hits**

```bash
git grep -n -E "conductor|Conductor" apps/perform/src/
```

For each remaining hit, decide: comment / log message / variable name. Update where it refers to **the orchestrator app itself** (now perform). Leave references to **historical `apps/symphony` → `apps/conductor` migration** in ADR-style header comments untouched.

- [ ] **Step 6: Re-run tests**

```bash
pnpm --filter perform test
```

Expected: PASS. If a test fails due to a renamed string assertion, update the assertion.

- [ ] **Step 7: Commit**

```bash
git add apps/perform/src/
git commit -m "refactor(perform): rebrand internal strings (binary name, log messages, test names)"
```

---

### Task 6: Sweep `apps/e2e/` references

**Files:**
- Modify: `apps/e2e/config.json`
- Modify: `apps/e2e/claude-github.ts`
- Modify: `apps/e2e/lib/common.ts`
- Modify: `apps/e2e/workflow.claude-linear.md`
- Modify: `apps/e2e/workflow.claude-github.md`

- [ ] **Step 1: Audit**

```bash
git grep -n -E "conductor|concert|babie/concert" apps/e2e/
```

- [ ] **Step 2: Update `apps/e2e/config.json`**

```diff
   "github": {
-    "repo": "babie/concert",
+    "repo": "babie/studio",
     "issueNumber": 1,
```

- [ ] **Step 3: Update `apps/e2e/claude-github.ts` comments**

Find at line ~529 / ~532:

```diff
-  // Conductor's safeIdentifier (apps/conductor/src/workspace/path.ts)
+  // Perform's safeIdentifier (apps/perform/src/workspace/path.ts)
-  // apps/conductor/src/tracker/github/adapter.ts), so the workspace dir
+  // apps/perform/src/tracker/github/adapter.ts), so the workspace dir
```

Also update at line ~533:

```diff
-  // name ends up as e.g. `babie_concert_1`.
+  // name ends up as e.g. `babie_studio_1`.
```

- [ ] **Step 4: Update `apps/e2e/lib/common.ts`**

Replace any `conductor` references in path constants, command names, etc. The file currently centralizes backend commands — any `"conductor"` command name becomes `"perform"`.

- [ ] **Step 5: Update workflow MD files**

In `apps/e2e/workflow.claude-linear.md` and `workflow.claude-github.md`, replace:
- `apps/conductor/` → `apps/perform/` (path references)
- `conductor` (binary name) → `perform`
- `babie/concert` → `babie/studio` if present
- `concert` (project name) → `studio`

- [ ] **Step 6: Verify e2e setup script still runs (without actually hitting Linear/GitHub)**

```bash
pnpm --filter e2e build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/e2e/
git commit -m "refactor(e2e): update repo / path / binary references to studio + perform"
```

---

### Task 7: Update DevContainer + docker-compose + flake.nix

**Files:**
- Modify: `.devcontainer/devcontainer.json`
- Modify: `.devcontainer/docker-compose.yml`
- Modify: `flake.nix`

- [ ] **Step 1: Edit `.devcontainer/devcontainer.json`**

```diff
-  "name": "concert",
+  "name": "studio",
```

- [ ] **Step 2: Edit `.devcontainer/docker-compose.yml`**

```diff
-name: ${COMPOSE_PROJECT_NAME:-concert}
+name: ${COMPOSE_PROJECT_NAME:-studio}
```

- [ ] **Step 3: Edit `flake.nix`**

```diff
-  description = "concert: conductor + claude-app-server monorepo";
+  description = "studio: perform + claude-app-server monorepo";
```

- [ ] **Step 4: Audit for remaining hits in these files**

```bash
git grep -n -E "concert|conductor" .devcontainer/ flake.nix
```

Fix any remaining literal references (comments, env names, etc.).

- [ ] **Step 5: Commit**

```bash
git add .devcontainer/ flake.nix
git commit -m "chore(devcontainer): rebrand container name, compose project, flake description"
```

---

### Task 8: Sweep root-level documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`
- Modify: `docs/protocol.md`
- Modify: `docs/e2e_testing.md`

- [ ] **Step 1: Update `README.md`**

Apply these substitutions in context (don't blind-replace; preserve meaning):

- Title `# concert` → `# studio`
- First paragraph: `concert` モノレポ → `studio` モノレポ
- "Codex 専用だった Symphony を Claude にも対応させる" — wording can stay (historical context); update the present-tense description of what the repo is to "TypeScript で書かれた orchestrator (`apps/perform`) と `apps/claude-app-server` の 2 app 構成"
- "リポジトリ構成" section:
  ```
  studio/
  ├── apps/
  │   ├── perform/             # TypeScript、Codex App Server 互換 orchestrator
  │   ├── claude-app-server/   # TypeScript、Codex App Server 互換 JSON-RPC サーバ
  │   └── e2e/                 # E2E テストスクリプト・設定
  └── docs/                    # 設計・プロトコル・E2E 手順など
  ```
- Replace `apps/conductor` mentions with `apps/perform`
- Replace `conductor` binary references with `perform`
- "ステータス" section: update commands shown
- Quick start: `conductor apps/conductor/examples/workflow.claude-linear.md` → `perform apps/perform/examples/workflow.claude-linear.md`
- Demo video block (still present at this point) — leave for Task 11

- [ ] **Step 2: Update `CLAUDE.md` (root)**

- Title and first paragraph: `concert` is → `studio` is
- "このリポジトリは何" section: update narrative (M3 で `apps/conductor` (TS) に書き直し → M4 で `apps/perform` にリブランディング)
- "ディレクトリ構成" section: `apps/conductor/` → `apps/perform/`
- "重要前提": `concert` への追従不要 → `studio` への追従不要
- "コミットメッセージ": example `feat(conductor):` → `feat(perform):`
- "Codex backend で issue 処理が動く": example path `examples/workflow.codex.md` 等 path that reference apps/conductor changed to apps/perform
- DevContainer 起動: `COMPOSE_PROJECT_NAME` 例 `babie-concert_nix` → `babie-studio_nix`

- [ ] **Step 3: Update `docs/architecture.md`**

```bash
sed -i 's/apps\/conductor/apps\/perform/g; s/conductor/perform/g; s/concert/studio/g' docs/architecture.md
```

Then review the diff manually and revert any over-aggressive substitutions (e.g., the word "conductor" used in a music metaphor for the **role**, not the binary). If the word is meant as the orchestrator role, prefer `orchestrator` over a literal swap.

- [ ] **Step 4: Update `docs/protocol.md`**

Same approach as Step 3:

```bash
sed -i 's/apps\/conductor/apps\/perform/g; s/conductor/perform/g; s/concert/studio/g' docs/protocol.md
```

Manually review the diff. Note: `docs/protocol.md` references both `apps/perform` (orchestrator side) and `apps/claude-app-server` (server side) — make sure the directional references are still correct.

- [ ] **Step 5: Update `docs/e2e_testing.md`**

```bash
sed -i 's/apps\/conductor/apps\/perform/g; s/conductor/perform/g; s/concert/studio/g' docs/e2e_testing.md
```

Review diff for log file names (`backend.log` should stay; `symphony.log` was already removed in M3 Phase 7).

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/architecture.md docs/protocol.md docs/e2e_testing.md
git commit -m "docs(root): rebrand to studio + perform throughout README, CLAUDE.md, and docs/"
```

---

### Task 9: Sweep app-specific CLAUDE.md / README.md

**Files:**
- Modify: `apps/perform/CLAUDE.md`
- Modify: `apps/perform/README.md`
- Modify: `apps/claude-app-server/CLAUDE.md`
- Modify: `apps/claude-app-server/README.md`

- [ ] **Step 1: Update `apps/perform/CLAUDE.md`**

- Title: `# apps/conductor 実装指示書` → `# apps/perform 実装指示書`
- "あなたの担当": `concert モノレポの orchestrator` → `studio モノレポの orchestrator`
- "このアプリの位置づけ" / "TS スタック" / "設計指針" sections: replace `apps/conductor` with `apps/perform`, `conductor` (when referring to the app/binary) with `perform`
- Historical narrative ("Milestone 3 で TypeScript に書き直して現在の形になりました") — extend with "Milestone 4 でリブランディングして `apps/perform` になった ([ADR-0017](../../docs/adr/0017-rebranding-to-studio.md))"

- [ ] **Step 2: Update `apps/perform/README.md`**

Search and replace `conductor` → `perform`, `concert` → `studio`, `apps/conductor` → `apps/perform`. Review for accuracy.

- [ ] **Step 3: Update `apps/claude-app-server/CLAUDE.md`**

Find references to `apps/conductor` (the caller) and replace with `apps/perform`. Update narrative descriptions of what the orchestrator is called.

- [ ] **Step 4: Update `apps/claude-app-server/README.md`**

Same approach.

- [ ] **Step 5: Audit residuals in apps/**

```bash
git grep -n -E "apps/conductor|conductor" apps/ | grep -v 'docs/superpowers' | grep -v 'docs/adr'
```

Fix any remaining literal hits in non-history files.

- [ ] **Step 6: Commit**

```bash
git add apps/perform/CLAUDE.md apps/perform/README.md apps/claude-app-server/CLAUDE.md apps/claude-app-server/README.md
git commit -m "docs(apps): rebrand per-app CLAUDE.md and README.md to studio + perform"
```

---

### Task 10: Update `apps/perform/examples/*`

**Files:**
- Modify: `apps/perform/examples/workflow.claude-linear.md`
- Modify: `apps/perform/examples/workflow.claude-github.md`
- Modify: `apps/perform/examples/workflow.claude-memory.md`
- Modify: `apps/perform/examples/workflow.codex-memory.md`
- Modify: `apps/perform/examples/workflow.mock-memory.md`

- [ ] **Step 1: Audit**

```bash
git grep -n -E "conductor|concert" apps/perform/examples/
```

- [ ] **Step 2: Update workspace.root paths**

For each example file, update `workspace.root` from `/tmp/conductor/...` or `/tmp/concert-conductor-e2e/...` to `/tmp/studio/...`:

In `workflow.claude-memory.md`:
```diff
 workspace:
-  root: /tmp/concert-conductor-e2e/workspaces
+  root: /tmp/studio-e2e/workspaces

 hooks:
   after_create: |
     git init
-    git config user.email "agent@concert.local"
+    git config user.email "agent@studio.local"
-    git config user.name "Concert Agent"
+    git config user.name "Studio Agent"
```

Apply analogous edits to the other workflow files (linear, github, codex-memory, mock-memory).

- [ ] **Step 3: Update comments**

Comments referring to `conductor` (the orchestrator) become `perform`. Comments about the architectural role / ADRs stay as-is.

- [ ] **Step 4: Commit**

```bash
git add apps/perform/examples/
git commit -m "docs(perform): update example workflow files to use studio paths + perform binary"
```

---

### Task 11: Remove excluded files and rewrite README acknowledgment

**Files:**
- Delete: `docs/vendor/` (entire directory)
- Delete: `SPEC.md`
- Delete: `memory/` (entire directory, **/workspace/memory/**, not auto-memory)
- Delete: `.github/media/symphony-demo.mp4`
- Delete: `.github/media/symphony-demo.jpg`
- Modify: `README.md` (replace demo video block)
- Modify: `README.md` (`ドキュメント` section: remove `docs/vendor/codex/app-server.md` link)

- [ ] **Step 1: Delete excluded files**

```bash
# /workspace 配下で実行
rm -rf docs/vendor/
rm -f SPEC.md
rm -rf memory/                          # /workspace/memory/ (in-repo の旧 auto-memory 遺物)
                                        # ~/.claude/projects/-workspace/memory/ (本物の auto-memory) は触らない
rm -f .github/media/symphony-demo.mp4 .github/media/symphony-demo.jpg
```

- [ ] **Step 2: Verify `.github/media/` is still present (for `pull_request_template.md` neighbors)**

```bash
ls .github/
```

Expected: `media` (empty after symphony-demo removal) and `pull_request_template.md`. If `media` is now empty, leave it (a future asset may use it). If you prefer cleaner state, `rmdir .github/media`.

- [ ] **Step 3: Replace demo video block in README.md**

Find the block:

```markdown
[![Symphony demo video preview](.github/media/symphony-demo-poster.jpg)](.github/media/symphony-demo.mp4)

_デモは本家 Symphony のもの。Claude バックエンドでも同じフローが動くことをゴールにしています。_
```

Replace with:

```markdown
> 本家 Symphony のデモ動画は [openai/symphony](https://github.com/openai/symphony) のリポジトリで参照できます。`studio` も同等のフローを Claude バックエンドで動かすことを目指しています。
```

- [ ] **Step 4: Remove `docs/vendor/codex/app-server.md` from README ドキュメント section**

Find and remove this line:

```diff
-- [`docs/vendor/codex/app-server.md`](docs/vendor/codex/app-server.md) — Codex App Server SPEC のスナップショット（参考）
```

- [ ] **Step 5: Verify build and tests still pass**

```bash
pnpm build && pnpm test
```

Expected: PASS. (Removing docs/vendor/ should not affect builds.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(repo): drop third-party vendor docs, obsolete SPEC.md, in-repo memory remnants, symphony-demo media

Excluded from the upcoming babie/studio fresh repo:
- docs/vendor/ (third-party content, archived in babie/concert-archive)
- SPEC.md (obsolete Symphony spec)
- /workspace/memory/ (legacy in-repo auto-memory, not the real ~/.claude memory)
- .github/media/symphony-demo.* (outdated branding)

README demo-video block replaced with text reference to upstream openai/symphony."
```

---

### Task 12: Write ADR-0017 + update ADR README

**Files:**
- Create: `docs/adr/0017-rebranding-to-studio.md`
- Modify: `docs/adr/README.md`

- [ ] **Step 1: Read existing ADR format**

```bash
cat docs/adr/0015-conductor-port-completion.md | head -50
```

Match the format (Status / Context / Decision / Consequences / Alternatives / Related).

- [ ] **Step 2: Create `docs/adr/0017-rebranding-to-studio.md`**

```markdown
# ADR-0017: Rebrand `babie/concert` → `babie/studio`, `apps/conductor` → `apps/perform`

**Status:** Accepted (2026-05-18)

## Context

M3 完了で `apps/symphony` (Elixir) を削除し、`apps/conductor` (TypeScript) に統一した ([ADR-0015](0015-conductor-port-completion.md))。M4 以降は umbrella CLI (`apps/{compose,perform,mix}`) や state 別 backend 切替などの機能拡張に入るため、リブランディングを最初に一括で済ませる必要がある。

加えて、これまでの開発で第三者著作物 (`docs/vendor/*`) が public 履歴に残ったままだが、`babie/concert` が fork repo であるため GitHub の制限で private 化できない。リブランディングをフレッシュリポジトリへの移行として実施することで、公開履歴から第三者著作物を確実に排除できる。

## Decision

1. **Repository**: `babie/concert` (public, fork) を破棄し、`babie/studio` (public, 通常 repo, Apache-2.0) を新規作成する。旧 repo は `babie/concert-archive` (private 通常 repo) に mirror push したうえで削除する。
2. **Sub-app**: `apps/conductor` を `apps/perform` にリネーム。binary 名も `conductor` → `perform`。
3. **NPM scope**: `@babie/*` を据置 (将来 `@cyfyapp/*` への変更が必要になったタイミングで再判断)。
4. **Umbrella name**: `studio` (= `apps/{compose,perform,mix}` を抱える制作スタジオのメタファー)。
5. **Excluded from new repo**: `docs/vendor/`, `SPEC.md`, `/workspace/memory/`, `.github/media/symphony-demo.*`。
6. **License**: Apache-2.0 継承 (本家 openai/symphony と同じ)。
7. **README 謝辞**: openai/symphony 出自を明示する文言は残す。

## Alternatives Considered

- **`cyfyapp/studio` (org 移行)**: 将来の `cyfyapp/score` SaaS とブランド統一できるが、個人 fork の出自が見えにくくなる。`@cyfyapp/*` npm scope reserve も必要。M4 段階では先送り。
- **`git filter-repo` で履歴を書き換え**: `docs/vendor/*` を全 commit から除去して in-place rename。漏れ検知が困難、commit hash 参照も結局壊れる。フレッシュ移行のほうがクリーン。
- **GitHub Support に fork 解除依頼**: `babie/concert` を private 化するために fork relationship を detach。サポート待ちが発生、また旧 repo に履歴が残るので docs/vendor 問題は解決しない。
- **Umbrella 名 `song` / `band` / `opus`**: 候補として検討。`song` は generic すぎて商標化困難、`band` は冗長 (`band perform`)、`opus` は Claude モデル名と紛らわしい。`studio` を採用。

## Consequences

- 旧 commit hash 参照は dead に。過去 ADR / spec 内の `concert` / `conductor` 表記は履歴として残し、本 ADR で「以後 `studio` / `perform` を使う」と宣言する。
- `babie/concert-archive` (private) が履歴参照用として残り、外部からは見えない。
- 旧 OrbStack ボリューム (`babie-concert_{home,nix}`) はリネーム不可、新ボリュームに tar 移行する。
- macOS native Claude Code のプロジェクトディレクトリ (`-Users-…-concert`) は手動 rename + 再認識が必要。
- `bin: conductor` から `bin: perform` への変更により、ユーザー (開発者本人) のシェル alias / スクリプトは更新が必要。

## Related

- [ADR-0008](0008-symphony-to-conductor-migration.md) — Symphony (Elixir) → Conductor (TS) 移行決定
- [ADR-0015](0015-conductor-port-completion.md) — Conductor port 完了
- [`docs/superpowers/specs/2026-05-18-m4-rebranding-design.md`](../superpowers/specs/2026-05-18-m4-rebranding-design.md) — 本リブランディングの設計書
- [`docs/milestones/04-rebranding.md`](../milestones/04-rebranding.md) — M4 完了記録 (M4 完了時に finalize)
```

- [ ] **Step 3: Add to `docs/adr/README.md` table**

Append a row to the ADR table (match existing format):

```markdown
| [0017](0017-rebranding-to-studio.md) | Rebrand `babie/concert` → `babie/studio`, `apps/conductor` → `apps/perform` | Accepted | 2026-05-18 |
```

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0017-rebranding-to-studio.md docs/adr/README.md
git commit -m "docs(adr): file ADR-0017 (rebranding to studio + perform)"
```

---

### Task 13: Create `docs/milestones/04-rebranding.md` stub + update README

**Files:**
- Create: `docs/milestones/04-rebranding.md`
- Modify: `docs/milestones/README.md`

- [ ] **Step 1: Create stub**

```markdown
# Milestone 4: リブランディング (`babie/concert` → `babie/studio`)

**ステータス:** 進行中 (Phase 4c / 4b ユーザーアクション完了で finalize)

詳細・チェックリスト: [`docs/superpowers/specs/2026-05-18-m4-rebranding-design.md`](../superpowers/specs/2026-05-18-m4-rebranding-design.md)

実装プラン: [`docs/superpowers/plans/2026-05-18-m4-rebranding.md`](../superpowers/plans/2026-05-18-m4-rebranding.md)

ADR: [`0017-rebranding-to-studio.md`](../adr/0017-rebranding-to-studio.md)

---

## 完了サマリ (M4 完了時に埋める)

- 完了日: TBD
- Phase 4a 完了 commit: TBD
- Phase 4b 完了タイミング: TBD
- Phase 4c E2E 緑確認: TBD
- 旧 OrbStack ボリューム削除: TBD
- `babie/concert` GitHub 削除: TBD

## 引っかかった点 (M4 完了時に埋める)

(TBD)

## 振り返り (M4 完了時に埋める)

(TBD)
```

- [ ] **Step 2: Add to `docs/milestones/README.md` table**

Append:

```markdown
| [04: リブランディング](04-rebranding.md) | `babie/concert` を `babie/studio` にフレッシュ移行、`apps/conductor` → `apps/perform` | (進行中) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/milestones/04-rebranding.md docs/milestones/README.md
git commit -m "docs(milestones): add M4 rebranding stub (to be finalized in Phase 4c)"
```

---

### Task 14: Rewrite TODO.md to new pointer style

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Read current TODO.md**

```bash
cat TODO.md | head -110
```

The current TODO.md has 295 lines including the full M3 phase breakdown (now complete) and the M4 rebranding subsection (now superseded by this spec/plan).

- [ ] **Step 2: Rewrite header + remove M3 section**

The new TODO.md starts:

```markdown
# 実装 Todo

`studio` モノレポの実装タスク一覧。詳細は各 CLAUDE.md と各 spec を参照。

完了済みマイルストーンの記録は [`docs/milestones/`](docs/milestones/) を参照。

---

# Milestone 4: リブランディング (進行中)

詳細・チェックリスト: [`docs/superpowers/specs/2026-05-18-m4-rebranding-design.md`](docs/superpowers/specs/2026-05-18-m4-rebranding-design.md)

実装プラン: [`docs/superpowers/plans/2026-05-18-m4-rebranding.md`](docs/superpowers/plans/2026-05-18-m4-rebranding.md)

---

# Milestone 5 以降 (候補)

下記は M4 完了後に改めて議論する。スキーマ・実装方針はその時点で決定する。
```

- [ ] **Step 3: Migrate future candidate items from old TODO.md**

Copy the **non-M4-rebranding** subsections from the old M4 section (state 別 backend 切替, Web ダッシュボード, conductor TUI snapshot 回帰検出, BackendConfig 系の discriminant を `kind` に統一, tracker adapter 全体を `Result.pipe`, `apps/composer`, `apps/mixer`, `apps/score`, ステート毎の使用スキルカスタマイズ, ダッシュボード対応, `apps/claude-app-server` ストリーミング & トークン使用量対応, workspace を git worktree ベースに移行, `@babie/` scope での npmjs 公開, prompt 構築方式の Liquid 依存見直し, claude-app-server / Conductor の重複コード共有 package 化, Conductor backend の BackendSession 2 層化リファクタ, SSH 経由の workspace 分散実行, GitHub Adapter 派生課題) to under the new `# Milestone 5 以降 (候補)` heading.

For each migrated item:
- Replace `apps/conductor` → `apps/perform`
- Replace `conductor` (binary/app references) → `perform`
- Replace `concert` (project name) → `studio`
- Replace `Conductor` (heading-case noun) → `Perform`
- Keep `[ADR-NNNN]` and `docs/superpowers/specs/...` links as historical references
- Re-title where appropriate (e.g., "conductor TUI snapshot 回帰検出" → "perform TUI snapshot 回帰検出")

- [ ] **Step 4: Drop the "リブランディング: cyfyapp org 移行 + song umbrella + サブコマンド化" subsection**

This is now realized by ADR-0017 + this spec/plan and superseded; remove the entire `## リブランディング: ...` section from M5+ candidates.

- [ ] **Step 5: Verify final length**

```bash
wc -l TODO.md
```

Expected: significantly shorter than the old 295-line version (likely 150-200 lines after removing M3 detail and the rebranding subsection).

- [ ] **Step 6: Commit**

```bash
git add TODO.md
git commit -m "docs(todo): switch to pointer style (M4 detail moved to spec/plan, M3 to milestone record)

Future candidate items renamed to studio/perform terminology. The cyfyapp +
song subsection from the old M4 candidates is superseded by ADR-0017 and
removed."
```

---

### Task 15: Phase 4a final verification

**Files:** (verification only, no changes)

- [ ] **Step 1: Clean install + build + test**

```bash
pnpm install
pnpm build
pnpm test
```

Expected: all PASS.

- [ ] **Step 2: Grep audit — `concert`**

```bash
git grep -i "concert"
```

Expected hits only in:
- `docs/adr/0001-*.md` 〜 `0016-*.md`, `docs/adr/README.md` (historical ADR text)
- `docs/milestones/` (history)
- `docs/superpowers/specs/`, `docs/superpowers/plans/` (history)
- `docs/adr/0017-rebranding-to-studio.md` (cites old name as predecessor)
- `docs/milestones/04-rebranding.md` (cites old name)
- `TODO.md` (M4 title may cite predecessor in the heading — acceptable)
- `README.md` 謝辞節 (Symphony 出自への謝辞、`concert` 表記は使わない)

If any **non-history file** has `concert`, fix it.

- [ ] **Step 3: Grep audit — `conductor`**

```bash
git grep -E "(^|[^A-Za-z])conductor([^A-Za-z]|$)"
```

Same expected hits (historical docs + ADR-0017 + 04-rebranding.md).

- [ ] **Step 4: Grep audit — `symphony` (continuation of M3 sweep)**

```bash
git grep -i "symphony"
```

Same expected hits (history + README acknowledgment + ADR-0017 references).

- [ ] **Step 5: List files in tree to confirm excluded set is gone**

```bash
ls docs/vendor/ 2>/dev/null && echo "FAIL: docs/vendor still exists" || echo "OK: docs/vendor removed"
ls SPEC.md 2>/dev/null && echo "FAIL: SPEC.md still exists" || echo "OK: SPEC.md removed"
ls memory/ 2>/dev/null && echo "FAIL: /workspace/memory still exists" || echo "OK: memory/ removed"
ls .github/media/symphony-demo.mp4 2>/dev/null && echo "FAIL: symphony-demo.mp4 still exists" || echo "OK: symphony-demo media removed"
ls apps/conductor 2>/dev/null && echo "FAIL: apps/conductor still exists" || echo "OK: apps/conductor renamed"
ls apps/perform 2>/dev/null && echo "OK: apps/perform present" || echo "FAIL: apps/perform missing"
```

Expected: all `OK` lines.

- [ ] **Step 6: Verify final commit list**

```bash
git log --oneline main..feat/m4-rebranding
```

Expected: 14 commits (Tasks 2-14), in order.

- [ ] **Step 7: Pause — user reviews diff**

Report to user:

> "Phase 4a complete on `feat/m4-rebranding`. Build / test green. `git grep -i concert/conductor` clean except historical docs + ADR-0017 + milestone record. Ready for Phase 4b cutover. Run `git diff main..feat/m4-rebranding --stat` to scan the file-level changes."

**Do not push.** The branch stays local until Phase 4b B2 rsyncs the working tree into the fresh `babie/studio` repo.

---

## Phase 4b: Cutover (USER ACTION required)

Phase 4b consists of commands the user runs across GitHub / macOS / OrbStack. The agent provides exact commands but cannot execute most of them (operations span the macOS host and require interactive confirmation). After Phase 4b B5, the agent's session ends; a new agent session resumes in Phase 4c inside the new DevContainer.

---

### Task 16: USER ACTION — Mirror push `babie/concert` to `babie/concert-archive`

**Spec reference:** Phase 4b B1.

- [ ] **Step 1: Tell the user what to run**

> "Phase 4b starts. Please run these commands on the macOS host (or in the old DevContainer if `gh auth` is set up there):
>
> ```bash
> # 1. Mirror clone
> git clone --mirror git@github.com:babie/concert.git /tmp/concert-mirror.git
> cd /tmp/concert-mirror.git
>
> # 2. Create private archive repo (this is a normal repo, NOT a fork)
> gh repo create babie/concert-archive \
>   --private \
>   --description 'Archive of babie/concert (predecessor of babie/studio). Contains historical commits including docs/vendor/* (do not redistribute).'
>
> # 3. Mirror push all refs
> git push --mirror git@github.com:babie/concert-archive.git
> ```
>
> Confirm in GitHub UI that `babie/concert-archive` shows up under your repos, is marked private, and has the same branch / tag count as `babie/concert`."

- [ ] **Step 2: Wait for user confirmation**

User says "archive done" → proceed to Task 17.

If failure: see spec rollback ("失敗時は `gh repo delete babie/concert-archive --yes`").

---

### Task 17: USER ACTION — Create `babie/studio` + rsync + initial commit

**Spec reference:** Phase 4b B2.

- [ ] **Step 1: Tell the user what to run**

> "Now create the new public repo and push the cleaned tree. Run these in the **old DevContainer** with `feat/m4-rebranding` checked out and the working tree clean:
>
> ```bash
> # 1. Create the public studio repo
> gh repo create babie/studio \
>   --public \
>   --description 'Personal orchestrator monorepo for Claude / Codex' \
>   --license=Apache-2.0
>
> # 2. rsync the working tree (exclude .git and other artifacts)
> mkdir /tmp/studio-fresh
> cd /workspace
> rsync -av \
>   --exclude='.git' \
>   --exclude='node_modules' \
>   --exclude='dist' \
>   --exclude='.direnv' \
>   --exclude='docs/vendor' \
>   --exclude='SPEC.md' \
>   --exclude='memory' \
>   --exclude='.github/media/symphony-demo.*' \
>   --exclude='apps/e2e/backend.log' \
>   --exclude='apps/e2e/symphony.log' \
>   ./ /tmp/studio-fresh/
>
> # 3. Fresh git init + initial commit
> cd /tmp/studio-fresh
> git init -b main
> git add -A
> git status   # ← verify no unwanted files
> git commit -m 'init: babie/studio monorepo
>
> See ADR-0017 for the rebranding decision and docs/milestones/04-rebranding.md
> for the migration log.'
>
> # 4. Push
> git remote add origin git@github.com:babie/studio.git
> git push -u origin main
> ```
>
> Verify in GitHub UI:
> - `babie/studio` exists, is public, Apache-2.0
> - `docs/vendor/`, `SPEC.md`, `memory/`, `.github/media/symphony-demo.*` are **not present**
> - `apps/perform/` is present, `apps/conductor/` is not"

- [ ] **Step 2: Wait for user confirmation**

User says "studio pushed" → proceed to Task 18.

---

### Task 18: USER ACTION — macOS directory rename + Claude Code memory move

**Spec reference:** Phase 4b B3 / B3.x.

- [ ] **Step 1: Tell the user what to run on macOS**

> "On the macOS host (NOT inside the DevContainer), stop the old container and rename the project directory.
>
> ```bash
> # 1. Stop the old DevPod workspace
> devpod stop concert
>
> # 2. Move the local project dir (adjust paths to your layout)
> cd ~/projects   # ← wherever you keep workspaces
> mv concert studio
>
> # 3. Re-clone the new repo cleanly (origin URL changes)
> rm -rf studio
> git clone git@github.com:babie/studio.git
> cd studio
> ```
>
> If you use **macOS-native Claude Code** (separate from DevContainer Claude Code), also migrate the memory directory:
>
> ```bash
> # Find the Claude Code project storage dir
> ls ~/.claude/projects/ | grep -i concert
> # Example output: -Users-babie-projects-concert
>
> # Rename it
> mv ~/.claude/projects/-Users-babie-projects-concert \
>    ~/.claude/projects/-Users-babie-projects-studio
>
> # Restart Claude Code so it picks up the new path
> ```
>
> If macOS Claude Code can't find old conversations after restart, the storage path encoding may differ. Recovery: manually copy memory files from old dir into the new one."

- [ ] **Step 2: Wait for user confirmation**

User says "macOS rename done" → proceed to Task 19.

---

### Task 19: USER ACTION — OrbStack volume tar migration

**Spec reference:** Phase 4b B4.

- [ ] **Step 1: Tell the user what to run on macOS**

> "Migrate the old `~/.claude/`, shell config, and dotfiles from the old `home` Docker volume to the new one. Run on the macOS host (Docker / OrbStack CLI accessible):
>
> ```bash
> # 1. Export old home volume to tar (alpine container is ephemeral, --rm)
> cd ~
> docker run --rm \
>   -v babie-concert_home:/data \
>   -v $(pwd):/backup \
>   alpine \
>   tar czf /backup/concert-home.tar.gz -C /data .
> # ↑ Result: ~/concert-home.tar.gz
> #   /data and /backup are mountpoints INSIDE the alpine container, not macOS paths
>
> # 2. Start new DevContainer briefly to provision babie-studio_home / babie-studio_nix
> cd ~/projects/studio
> devpod up .
> devpod stop studio
>
> # 3. Extract into the new home volume
> cd ~
> docker run --rm \
>   -v babie-studio_home:/data \
>   -v $(pwd):/backup \
>   alpine \
>   sh -c 'cd /data && tar xzf /backup/concert-home.tar.gz'
>
> # 4. (If file ownership is wrong) fix uid/gid for dev user (uid 1000)
> docker run --rm \
>   -v babie-studio_home:/data \
>   alpine \
>   chown -R 1000:1000 /data/dev
> ```
>
> The `/nix` volume is NOT migrated (Nix store re-builds on first `direnv reload`)."

- [ ] **Step 2: Wait for user confirmation**

User says "volume migration done" → proceed to Task 20.

---

### Task 20: USER ACTION — Start new DevContainer, hand off to Phase 4c agent

**Spec reference:** Phase 4b B5.

- [ ] **Step 1: Tell the user what to run**

> "Final cutover step. Start the new DevContainer:
>
> ```bash
> cd ~/projects/studio
> devpod up .
> devpod ssh studio
> ```
>
> Inside the new container:
>
> ```bash
> cd /workspace
> ls -la ~/.claude/           # should contain the migrated state
> claude --version            # should be installed
> # If 'claude' commands require re-login:
> claude login
> ```
>
> Once the new container is up and `claude` is logged in, **start a fresh Claude Code session here** (not in the old container). Then resume this plan at Task 21 (Phase 4c)."

- [ ] **Step 2: Session boundary**

The agent session driving Phase 4a/4b ends here. A new agent session in the new DevContainer resumes from Task 21.

**Do NOT delete `babie/concert` yet.** It remains the safety net until Phase 4c E2E is green (Task 27).

---

## Phase 4c: New-environment verification (Agent in new DevContainer)

Resumes in a fresh Claude Code session inside the new `babie/studio` DevContainer.

---

### Task 21: Verify environment migration

**Files:** (verification only)

- [ ] **Step 1: Confirm working directory and repo**

```bash
cd /workspace
git remote -v
```

Expected: `origin git@github.com:babie/studio.git (fetch/push)`.

- [ ] **Step 2: Confirm migrated home contents**

```bash
ls -la ~/.claude/
ls ~/.claude/projects/ | head -5
```

Expected: `.credentials.json` (or equivalent), `projects/`, `settings.json` etc. should exist.

- [ ] **Step 3: Confirm Claude CLI login**

```bash
claude --version
# If needed:
# claude login
```

Expected: version printed without prompting for login.

- [ ] **Step 4: Install deps + build**

```bash
pnpm install
pnpm build
```

Expected: PASS for both apps.

- [ ] **Step 5: Run unit / integration tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Link binaries globally for E2E**

```bash
pnpm dev:install
which perform              # should be on PATH
which claude-app-server    # should be on PATH
```

Expected: both binaries resolve.

- [ ] **Step 7: No commit yet** (this is verification only).

---

### Task 22: Set up new Linear / GitHub test issues

**Files:**
- Possibly modify: `apps/e2e/config.json` (if issue numbers / keys changed)

- [ ] **Step 1: Linear — verify or create test issue**

User-driven step (Linear UI):
- Open Linear, navigate to the team / project used for E2E (currently `CYFY` team, issue `CYFY-5`)
- If the project name had `concert` in it, rename to `studio` (Linear UI: project settings → name)
- Ensure `CYFY-5` exists, is in `Todo` state, and has no assignee constraints that would block E2E

If issue key changed (e.g., new project = new prefix), update `apps/e2e/config.json`:

```diff
   "linear": {
-    "issueKey": "CYFY-5",
+    "issueKey": "<new-key>",
```

- [ ] **Step 2: GitHub — create test issue in `babie/studio`**

User-driven (or via `gh issue create`):

```bash
gh issue create \
  --repo babie/studio \
  --title "Hello World E2E test" \
  --body "Test issue for pnpm test:e2e:claude-github"
```

Note the issue number (likely #1 if this is the first issue).

- Add the issue to your GitHub Project (v2) board with Status field = `Todo`
- Ensure Status field has options: `Todo`, `In Progress`, `Done`

Update `apps/e2e/config.json` if the issue number differs from 1:

```diff
   "github": {
     "repo": "babie/studio",
-    "issueNumber": 1,
+    "issueNumber": <new-number>,
```

- [ ] **Step 3: Commit any config changes**

```bash
# Only if apps/e2e/config.json changed in Step 1 or 2:
git add apps/e2e/config.json
git commit -m "chore(e2e): update test issue refs for babie/studio cutover"
git push
```

---

### Task 23: Run E2E tests

**Files:** (verification only)

- [ ] **Step 1: Ensure env vars are set**

```bash
echo $LINEAR_API_KEY | head -c 10   # should print first 10 chars (not empty)
echo $GITHUB_TOKEN | head -c 10     # should print first 10 chars
```

If empty, user re-exports them (`.env.local` or shell init).

- [ ] **Step 2: Run Linear E2E**

```bash
pnpm test:e2e:claude-linear
```

Expected: PASS. The test runs perform against the Linear `CYFY-5` issue, drives it through `Todo → In Progress → Done`.

- [ ] **Step 3: Run GitHub E2E**

```bash
pnpm test:e2e:claude-github
```

Expected: PASS. The test runs perform against the `babie/studio#<n>` issue, drives it through `Todo → In Progress → Done`.

- [ ] **Step 4: Run combined E2E**

```bash
pnpm test:e2e
```

Expected: PASS (both trackers).

- [ ] **Step 5: If E2E fails**

Diagnose per the spec's "エラーハンドリング" table. Common causes:
- GitHub Project Status field options missing (`Todo` / `In Progress` / `Done`)
- Linear project slug mismatch in `apps/e2e/config.json`
- Issue not in `Todo` state at start
- `claude` CLI not logged in (re-run `claude login`)

Fix, commit, and re-run.

---

### Task 24: Final grep audit + fix residuals

**Files:** any with residual references

- [ ] **Step 1: Comprehensive grep**

```bash
git grep -i "concert"
git grep -E "(^|[^A-Za-z])conductor([^A-Za-z]|$)"
git grep -i "symphony"
```

For each match, classify:
- **OK**: in `docs/adr/0001-*.md` 〜 `0016-*.md`, `docs/milestones/0[123]-*.md`, `docs/superpowers/specs/` history, `docs/superpowers/plans/` history, ADR-0017 / `docs/milestones/04-rebranding.md` (predecessor references), README acknowledgment
- **NOT OK**: any other location — fix it

- [ ] **Step 2: Verify excluded files still absent**

```bash
ls docs/vendor/ 2>/dev/null && echo "FAIL" || echo "OK: docs/vendor removed"
ls SPEC.md 2>/dev/null && echo "FAIL" || echo "OK: SPEC.md removed"
ls memory/ 2>/dev/null && echo "FAIL" || echo "OK: memory/ removed"
```

- [ ] **Step 3: If any residual found, fix and commit**

```bash
# Example fix for a residual
git add <file>
git commit -m "chore(repo): sweep missed concert/conductor refs in <file>"
git push
```

---

### Task 25: Finalize `docs/milestones/04-rebranding.md`

**Files:**
- Modify: `docs/milestones/04-rebranding.md`
- Modify: `docs/milestones/README.md`

- [ ] **Step 1: Fill in completion details**

Edit `docs/milestones/04-rebranding.md`, replacing TBD markers:

```markdown
**ステータス:** 完了 (YYYY-MM-DD)

## 完了サマリ

- 完了日: YYYY-MM-DD
- Phase 4a 完了 commit (`babie/concert-archive` 上): <archive-commit-hash>
- Phase 4b 完了タイミング: <date / event>
- Phase 4c E2E 緑確認: <date> (pnpm test:e2e:claude-linear / :claude-github)
- 旧 OrbStack ボリューム削除: (Task 27 完了時に追記、または「未削除、ソーク期間中」)
- `babie/concert` GitHub 削除: (Task 27 完了時に追記)

## 引っかかった点

- (実際に遭遇した事項を箇条書きで)
- 例: macOS Claude Code の memory dir rename で過去会話が見えなくなり、手動 cp で復元
- 例: GitHub Project の Status field option を新 issue に紐付け忘れて E2E 一度失敗

## 振り返り

- (短く)
```

- [ ] **Step 2: Update milestones README table**

```diff
-| [04: リブランディング](04-rebranding.md) | `babie/concert` を `babie/studio` にフレッシュ移行、`apps/conductor` → `apps/perform` | (進行中) |
+| [04: リブランディング](04-rebranding.md) | `babie/concert` を `babie/studio` にフレッシュ移行、`apps/conductor` → `apps/perform` | YYYY-MM-DD |
```

- [ ] **Step 3: Commit**

```bash
git add docs/milestones/04-rebranding.md docs/milestones/README.md
git commit -m "docs(milestones): finalize M4 rebranding milestone record"
git push
```

---

### Task 26: Update memory `feedback-todo-md-policy.md`

**Files:**
- Modify: `/home/dev/.claude/projects/-workspace/memory/feedback-todo-md-policy.md`
- Modify: `/home/dev/.claude/projects/-workspace/memory/MEMORY.md`

- [ ] **Step 1: Edit policy memory**

Update `feedback-todo-md-policy.md` content (file lives outside `/workspace`, in auto-memory):

```markdown
---
name: feedback-todo-md-policy
description: TODO.md は進行中マイルストーンを spec へのリンク 1 行で表現し、完了済みは docs/milestones/ に退避する studio リポジトリのポリシー
metadata:
  type: feedback
---

`studio` リポジトリの `TODO.md` は **進行中マイルストーンへの spec リンク 1 行 + 将来マイルストーン候補**のみを保持する。完了済みマイルストーンの記録は `docs/milestones/NN-<slug>.md` に退避し、TODO.md からは削除する。**進行中マイルストーンの詳細チェックリストも TODO.md には書かず、spec に集約する。**

**Why:** ユーザー指摘 (2026-05-18、M4 着手時)。spec と TODO.md で同じ情報を二重管理するのを避け、TODO.md は俯瞰用ポインタに専念させる。M3 完了時に `02-github-tracker.md` を作っても TODO.md に M2 セクションが残っていて重複していた事例の更なる発展。

**How to apply:** マイルストーン着手時 / 完了時の手順:

着手時:
1. `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md` を書く
2. `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` を書く
3. TODO.md に `# Milestone N: <title> (進行中)` セクションを追加、本文は spec + plan へのリンク 1〜2 行のみ

完了時:
1. `docs/milestones/NN-<slug>.md` を作成 (完了マークと振り返り)
2. **同時に** `TODO.md` から該当マイルストーンセクションを削除
3. 次の進行中マイルストーンを TODO.md の先頭セクションに据える

TODO.md の構造:
- 進行中マイルストーン (spec / plan リンク 1〜2 行のみ)
- 将来マイルストーン候補 (概要 2-3 行 + 関連 ADR / spec リンク)
```

- [ ] **Step 2: Update `MEMORY.md` index**

If the title / description changed, update the corresponding line in `MEMORY.md`:

```diff
-- [TODO.md 運用ポリシー](feedback-todo-md-policy.md) — 完了マイルストーンは docs/milestones/ に退避、TODO.md は進行中＋将来候補のみ
+- [TODO.md 運用ポリシー](feedback-todo-md-policy.md) — 進行中マイルストーンも spec リンク 1 行、TODO.md は俯瞰ポインタのみ
```

- [ ] **Step 3: No commit needed** (auto-memory is outside the git repo).

---

### Task 27: USER ACTION — Delete `babie/concert` + remove old OrbStack volumes

**Spec reference:** Phase 4b B6 / B7 (deferred to after Phase 4c green).

- [ ] **Step 1: Tell the user what to run**

> "Phase 4c verification is green. Safe to delete the old repo and volumes now (point of no return — `babie/concert-archive` remains as the historical backup).
>
> ```bash
> # 1. Delete the public fork
> gh repo delete babie/concert --yes
>
> # 2. Remove old OrbStack volumes (after a day or two of soak, optional)
> docker volume rm babie-concert_home babie-concert_nix
>
> # 3. Remove the tar archive used for migration
> rm ~/concert-home.tar.gz
> ```"

- [ ] **Step 2: Wait for user confirmation**

User says "old repo deleted" → proceed to Task 28.

---

### Task 28: Drop M4 section from TODO.md (final state)

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Remove the M4 section from TODO.md**

After Task 25 finalized the milestone record, the M4 entry in TODO.md is now redundant (per the new policy: completed milestones live in `docs/milestones/`, not TODO.md).

Edit `TODO.md` to remove this block:

```markdown
# Milestone 4: リブランディング (進行中)

詳細・チェックリスト: [`docs/superpowers/specs/2026-05-18-m4-rebranding-design.md`](docs/superpowers/specs/2026-05-18-m4-rebranding-design.md)

実装プラン: [`docs/superpowers/plans/2026-05-18-m4-rebranding.md`](docs/superpowers/plans/2026-05-18-m4-rebranding.md)
```

Optionally renumber `# Milestone 5 以降 (候補)` if you prefer (or leave as-is — M5 is the next active milestone, not a renumber).

- [ ] **Step 2: Verify TODO.md structure**

```bash
head -20 TODO.md
```

Expected: header → "完了済みマイルストーン記録は ..." → `# Milestone 5 以降 (候補)` (no progress section).

- [ ] **Step 3: Commit**

```bash
git add TODO.md
git commit -m "docs(todo): mark M4 rebranding complete (record moved to docs/milestones/04-rebranding.md)"
git push
```

---

### Task 29: M4 completion summary

**Files:** (verification only)

- [ ] **Step 1: Final state check**

```bash
git log --oneline -10
gh repo list babie | head
docker volume ls | grep babie
```

Expected:
- Recent commits include M4 milestone finalization
- `babie/studio` listed (public), `babie/concert-archive` listed (private), `babie/concert` NOT listed
- `babie-studio_home`, `babie-studio_nix` exist; `babie-concert_*` absent (after Task 27)

- [ ] **Step 2: Report to user**

Final summary:

> "M4 rebranding complete.
> - Repo: babie/concert → babie/studio (public), archive at babie/concert-archive (private)
> - Sub-app: apps/conductor → apps/perform
> - Excluded: docs/vendor/, SPEC.md, /workspace/memory/, .github/media/symphony-demo.*
> - DevContainer: studio name, babie-studio_{home,nix} volumes
> - E2E green on Linear + GitHub
> - ADR-0017 filed, docs/milestones/04-rebranding.md recorded, TODO.md back to pointer-only style
> - Memory feedback-todo-md-policy.md updated to the new policy"

---

## Notes for the implementer

- **No `git push` during Phase 4a.** The branch is local-only; `rsync` in Phase 4b transfers the working tree.
- **Phase 4b B6 (delete `babie/concert`) is gated on Phase 4c green.** This is the point of no return; verify E2E before user confirms.
- **Auto-memory at `~/.claude/projects/-workspace/memory/` is distinct from in-repo `/workspace/memory/`.** Task 11 deletes only the in-repo one. Task 26 updates the auto-memory.
- **History documents (`docs/adr/0001-*` 〜 `0016-*`, `docs/superpowers/{specs,plans}/`, `docs/milestones/0[123]-*`) are NOT swept** for `concert` / `conductor`. They are historical records of decisions at the time; preserving the original wording keeps the audit trail accurate.
- **The README acknowledgment to openai/symphony stays.** Apache-2.0 attribution + history is correct behavior.
- **The `@babie/*` npm scope stays.** No npm publish in this milestone; scope is decided when actual publish happens.
