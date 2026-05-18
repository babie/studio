# Monorepo 統合 (pnpm script 化) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TODO.md 実行順 6「モノレポ統合」を達成。当初計画された `scripts/build_all.sh` / `scripts/install_dev.sh` を作らず、root `package.json` の npm scripts に統合する。`dev:install` / `dev:uninstall` でグローバル symlink を管理し、`apps/claude-app-server/package.json` に `start` script を追加して開発時の手動疎通確認を容易にする。

**Architecture:** すべてのビルド/テスト/インストール tooling を root `package.json` の scripts に寄せる。`pnpm <verb>` = 全アプリ対象、`pnpm <verb>:<app-name>` = 個別アプリ対象、`pnpm dev:<verb>` = 開発環境セットアップ系という命名規約。Symphony 用には `cd apps/symphony && mix ...` 形を使い、claude-app-server には `pnpm --filter` を使う。`scripts/e2e.sh` のみ将来 (実行順 8) で bash 実装予定なので、`e2e` script の参照は維持する。

**Tech Stack:** pnpm (workspace), Node.js, Elixir/mix。新規依存なし。設計詳細は [`docs/superpowers/specs/2026-05-13-monorepo-integration-design.md`](../specs/2026-05-13-monorepo-integration-design.md)。

---

## File Structure

**Modify:**
- `/workspace/package.json` — `scripts` セクションを全面置き換え
- `/workspace/apps/claude-app-server/package.json` — `scripts` に `start` を追加
- `/workspace/TODO.md` — 実行順 6 のチェックリスト書き換え + 完了済みを `[x]` に
- `/workspace/CLAUDE.md` — 落とし穴節 (L341 周辺) の `scripts/install_dev.sh` 言及を `pnpm dev:install` / `pnpm dev:uninstall` に置換

**Create:** なし

**Delete:** なし

---

### Task 1: Refactor root package.json scripts

**Files:**
- Modify: `/workspace/package.json` (scripts セクション全体)

- [ ] **Step 1: 現状確認**

Run: `cat /workspace/package.json`
Expected: `scripts` セクションに `build: "pnpm -r build"`, `test: "pnpm -r test"`, `build:elixir`, `test:elixir`, `e2e` の 5 つが存在。

- [ ] **Step 2: scripts セクション全体を置き換え**

`/workspace/package.json` の `scripts` ブロックを以下に書き換える。`pnpm.overrides` セクションには触らない。

```json
"scripts": {
  "build": "pnpm build:claude-app-server && pnpm build:symphony",
  "build:claude-app-server": "pnpm --filter claude-app-server build",
  "build:symphony": "cd apps/symphony && mix build",
  "test": "pnpm test:claude-app-server && pnpm test:symphony",
  "test:claude-app-server": "pnpm --filter claude-app-server test",
  "test:symphony": "cd apps/symphony && mix test",
  "dev:install": "cd apps/claude-app-server && pnpm link --global",
  "dev:uninstall": "pnpm uninstall -g claude-app-server",
  "e2e": "./scripts/e2e.sh"
}
```

- [ ] **Step 3: 結果を JSON として検証**

Run: `cd /workspace && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && echo OK`
Expected: `OK` を出力 (JSON パースエラーなし)。

- [ ] **Step 4: `pnpm build:claude-app-server` を実行**

Run: `cd /workspace && pnpm build:claude-app-server 2>&1 | tail -10`
Expected: tsc 完走、`apps/claude-app-server/dist/bin.js` 更新、exit 0。

- [ ] **Step 5: `pnpm build:symphony` を実行**

Pre-condition: 必要なら `(cd apps/symphony && mix deps.get)` を先に走らせる。

Run: `cd /workspace && pnpm build:symphony 2>&1 | tail -10`
Expected: `mix build` (= `escript.build` alias、`apps/symphony/mix.exs:85` で定義) が完走し escript が `apps/symphony/bin/symphony` 等として生成される、exit 0。

- [ ] **Step 6: `pnpm build` 集約版を実行**

Run: `cd /workspace && pnpm build 2>&1 | tail -20`
Expected: build:claude-app-server → build:symphony の順で両方走り exit 0。

- [ ] **Step 7: `pnpm test:claude-app-server` を実行**

Run: `cd /workspace && pnpm test:claude-app-server 2>&1 | tail -15`
Expected: vitest が走り、全テスト PASS、exit 0。

- [ ] **Step 8: `pnpm test:symphony` を実行**

Run: `cd /workspace && pnpm test:symphony 2>&1 | tail -15`
Expected: ExUnit が走り、全テスト PASS、exit 0。

- [ ] **Step 9: `pnpm test` 集約版を実行**

Run: `cd /workspace && pnpm test 2>&1 | tail -20`
Expected: 両方走り全 PASS、exit 0。

- [ ] **Step 10: `dev:install` 前の状態確認**

Run: `which claude-app-server 2>&1 || echo "not on PATH (expected)"`
Expected: 「not on PATH」または別物が見つかる(無視可)。

- [ ] **Step 11: `pnpm dev:install` を実行**

Run: `cd /workspace && pnpm dev:install 2>&1 | tail -10`
Expected: pnpm が link 完了メッセージを出力、exit 0。

- [ ] **Step 12: link 結果を検証**

Run: `which claude-app-server && readlink -f "$(which claude-app-server)"`
Expected: pnpm global bin の下に `claude-app-server` が存在し、`/workspace/apps/claude-app-server/dist/bin.js` を指す symlink になっている。

- [ ] **Step 13: `pnpm dev:install` 冪等性確認**

Run: `cd /workspace && pnpm dev:install 2>&1 | tail -10 && echo "second-run exit: $?"`
Expected: 2 回目もエラーなし、exit 0。

- [ ] **Step 14: `pnpm dev:uninstall` を実行**

Run: `cd /workspace && pnpm dev:uninstall 2>&1 | tail -10`
Expected: pnpm が uninstall 完了、exit 0。

もし `ERR_PNPM_*` で失敗する場合: 失敗時の挙動をログに記録し、spec の「冪等性とアンインストール」節に従って `pnpm uninstall -g claude-app-server || true` 形に書き換えるか判断する (この時点では書き換えず、まず生の挙動を確認)。判断結果は本 Task のコミットメッセージに残す。

- [ ] **Step 15: uninstall 結果を検証**

Run: `which claude-app-server 2>&1 || echo "removed (expected)"`
Expected: 見つからない。

- [ ] **Step 16: 後続作業用に再 install**

Run: `cd /workspace && pnpm dev:install 2>&1 | tail -5`
Expected: link 復活、exit 0。これで Symphony Phase 2 (実行順 7) で `claude-app-server` を PATH 経由で起動できる状態に戻る。

- [ ] **Step 17: コミット**

Run:
```bash
cd /workspace
git add package.json
git commit -m "$(cat <<'EOF'
chore(repo): replace planned monorepo bash scripts with pnpm scripts

Implements docs/superpowers/specs/2026-05-13-monorepo-integration-design.md.

- build / test now cover both apps (previously TS only via pnpm -r)
- build:<app> / test:<app> for per-app targets (renamed :elixir to :symphony)
- dev:install / dev:uninstall manage the global claude-app-server symlink
- e2e reference kept as-is for execution order 8

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: コミット成功。

---

### Task 2: Add start script to apps/claude-app-server/package.json

**Files:**
- Modify: `/workspace/apps/claude-app-server/package.json`

- [ ] **Step 1: 現状確認**

Run: `grep -n '"scripts"' /workspace/apps/claude-app-server/package.json`
Expected: scripts セクション開始行が見つかる。

- [ ] **Step 2: `start` script を追加**

`/workspace/apps/claude-app-server/package.json` の scripts ブロックの先頭に `start` を追加 (build の前):

```diff
   "scripts": {
+    "start": "node dist/bin.js",
     "build": "tsc && chmod +x dist/bin.js",
     "test": "vitest run",
     "test:watch": "vitest",
     "lint": "oxlint src test",
     "format": "oxfmt src test",
     "format:check": "oxfmt --check src test"
   },
```

- [ ] **Step 3: JSON 妥当性検証**

Run: `node -e "JSON.parse(require('fs').readFileSync('/workspace/apps/claude-app-server/package.json','utf8'))" && echo OK`
Expected: `OK`。

- [ ] **Step 4: start 経由の起動確認**

Pre-condition: `dist/bin.js` は Task 1 Step 4 で更新済み。

Run: `cd /workspace && pnpm --filter claude-app-server start -- --help 2>&1 | tail -20`
Expected: claude-app-server の commander が生成する `Usage: ...` の help テキストが表示され exit 0。

- [ ] **Step 5: コミット**

Run:
```bash
cd /workspace
git add apps/claude-app-server/package.json
git commit -m "$(cat <<'EOF'
chore(claude-app-server): add start script for ad-hoc invocation

Lets `pnpm --filter claude-app-server start -- <opts>` invoke
the built bin.js without manually cd-ing into the app directory.
Useful for ad-hoc JSON-RPC protocol checks during development.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: コミット成功。

---

### Task 3: Update TODO.md execution order 6 checklist

**Files:**
- Modify: `/workspace/TODO.md` (「## モノレポ統合」セクション、L124 付近)

- [ ] **Step 1: 該当範囲を確認**

Run: `sed -n '120,135p' /workspace/TODO.md`
Expected: 「## モノレポ統合」見出しと旧チェックリスト4行 + 周辺の `---` 区切り。

- [ ] **Step 2: チェックリストを書き換え**

`/workspace/TODO.md` の以下のブロックを置換する。

Old (Task 1 と 2 で削除する箇所):
```
## モノレポ統合

- [ ] `scripts/build_all.sh`（両アプリビルド）
- [ ] `scripts/install_dev.sh`（claude-app-server を PATH に通す）
- [ ] `scripts/e2e.sh`（受け入れテスト一発実行、ルート CLAUDE.md 参照）
- [ ] LICENSE 配置確認（Apache-2.0 をルートに）
```

New:
```
## モノレポ統合

- [x] root `package.json` に `build` / `build:<app>` / `test` / `test:<app>` / `dev:install` / `dev:uninstall` scripts 追加
- [x] `apps/claude-app-server/package.json` に `start` script 追加
- [ ] `scripts/e2e.sh`（受け入れテスト一発実行、ルート CLAUDE.md 参照、実行順 8 で着手）
- [x] LICENSE 配置確認（Apache-2.0 をルートに）
```

- [ ] **Step 3: 結果検証**

Run: `sed -n '120,135p' /workspace/TODO.md`
Expected: 新 4 行が見える。3 つが `[x]`、`scripts/e2e.sh` 行のみ `[ ]`。

---

### Task 4: Update root CLAUDE.md 落とし穴節

**Files:**
- Modify: `/workspace/CLAUDE.md` (L341 付近)

- [ ] **Step 1: 該当箇所確認**

Run: `sed -n '337,343p' /workspace/CLAUDE.md`
Expected: 「### claude-app-server がインストールされていないと動かない」見出しと旧本文。

- [ ] **Step 2: 旧本文を置き換え**

Old:
```
開発時は `apps/claude-app-server/dist/bin.js` をシンボリックリンクするか、`pnpm link` するか、`scripts/install_dev.sh` で対応。
```

New:
```
開発時は `pnpm dev:install` (内部で `cd apps/claude-app-server && pnpm link --global` を実行) で対応。アンインストールは `pnpm dev:uninstall`。
```

- [ ] **Step 3: 結果検証**

Run: `grep -n "install_dev\|dev:install\|dev:uninstall" /workspace/CLAUDE.md`
Expected: `install_dev.sh` は無し。`dev:install` と `dev:uninstall` が新しい行に見える。

- [ ] **Step 4: TODO.md + CLAUDE.md を 1 コミットに**

Run:
```bash
cd /workspace
git add TODO.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(repo): update TODO and CLAUDE.md to reflect pnpm-based integration

Step 6 checklist now lists pnpm scripts (build / build:<app> / test /
test:<app> / dev:install / dev:uninstall / start) instead of the
previously planned scripts/build_all.sh + scripts/install_dev.sh.
CLAUDE.md 落とし穴 entry points to `pnpm dev:install` / `pnpm dev:uninstall`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: コミット成功。

---

### Task 5: 全体動作確認 (smoke test)

**Files:** なし (検証のみ)

- [ ] **Step 1: 全 script リスト**

Run: `cd /workspace && pnpm run`
Expected: build / build:claude-app-server / build:symphony / test / test:claude-app-server / test:symphony / dev:install / dev:uninstall / e2e の 9 個と、`apps/claude-app-server` の start / build / test / test:watch / lint / format / format:check は出ない (root のみ表示される)。

- [ ] **Step 2: `which claude-app-server` 最終確認**

Run: `which claude-app-server && readlink -f "$(which claude-app-server)"`
Expected: pnpm global bin 下に symlink、ターゲットは `/workspace/apps/claude-app-server/dist/bin.js`。

- [ ] **Step 3: ステータス clean 確認**

Run: `cd /workspace && git status --short && git log --oneline -5`
Expected: working tree clean、直近 3 コミットが本プランによるもの (Task 1 / Task 2 / Task 3+4)。

---

## Completion Criteria (spec から転記)

- [ ] ルート `package.json` の scripts が spec「変更後」と一致
- [ ] `apps/claude-app-server/package.json` に `start` script 追加済み
- [ ] `pnpm build` / `pnpm build:claude-app-server` / `pnpm build:symphony` がそれぞれ動作
- [ ] `pnpm test` / `pnpm test:claude-app-server` / `pnpm test:symphony` がそれぞれ動作
- [ ] `pnpm dev:install` 実行後、`which claude-app-server` で symlink が見つかる
- [ ] `pnpm dev:install` の 2 回連続実行がエラーにならない
- [ ] `pnpm dev:uninstall` 実行後、`which claude-app-server` で見つからなくなる
- [ ] `pnpm --filter claude-app-server start -- --help` が動く
- [ ] TODO.md 実行順 6 のチェックリストが本設計の文言に更新されている
- [ ] ルート `CLAUDE.md` の `scripts/install_dev.sh` 言及が `pnpm dev:install` に更新されている
- [ ] LICENSE 配置確認チェックボックスが完了済み
