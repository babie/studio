# Monorepo 統合: pnpm script 化 — 設計書

**日付:** 2026-05-13
**対象:** TODO.md 実行順 6「モノレポ統合」
**ステータス:** 設計確定、実装プラン待ち

---

## 背景

`concert` モノレポは現状、`apps/claude-app-server` (TypeScript / pnpm) と `apps/symphony` (Elixir / mix) の二系統ツールチェーンを抱える。TODO.md 当初案では両者を橋渡しする shell スクリプトとして `scripts/build_all.sh` と `scripts/install_dev.sh` を作る予定だったが、以下の理由で **root `package.json` の npm scripts に寄せる**方針に切り替える:

1. Milestone 2 以降で `apps/symphony` (Elixir) は `apps/conductor` (TypeScript) に置き換えられ削除される。最終形は pnpm-only。
2. ルート `package.json` には既に `build` / `test` / `build:elixir` / `test:elixir` が存在し、パターンが半分でき上がっている。
3. 「`scripts/` フォルダ + bash」を残しても、E2E 専用の `scripts/e2e.sh` (実行順 8 で作成) 1 本だけになる。

`scripts/e2e.sh` のみ bash で残す。e2e は build → install → 起動 → timeout → 検証と orchestration が深く、trap や timeout を bash で書く方が素直なため。

---

## 目標

- `pnpm build` で両アプリ (claude-app-server + symphony) をビルド
- `pnpm build:<app>` で個別アプリをビルド
- `pnpm test` で両アプリのテストを実行
- `pnpm test:<app>` で個別アプリのテストを実行
- `pnpm dev:install` で `claude-app-server` を PATH に通す (Symphony の subprocess 起動先として)
- `pnpm dev:uninstall` でグローバル symlink を解除
- `apps/claude-app-server/package.json` に `start` script を追加し、`pnpm --filter claude-app-server start -- <opts>` で開発中の手動疎通確認に使えるようにする
- 既存の `scripts/e2e.sh` (未作成) への参照は維持

---

## スキーマ規約

- **`pnpm <verb>`** = 全アプリ対象 (例: `pnpm build` / `pnpm test`)
- **`pnpm <verb>:<app-name>`** = 個別アプリ対象 (例: `pnpm build:claude-app-server`)
- **`pnpm dev:<verb>`** = 開発環境セットアップ系 (例: `pnpm dev:install` / `pnpm dev:uninstall`)
- `<app-name>` は `apps/<app-name>` ディレクトリ名と一致させる (`claude-app-server`, `symphony`)

将来 `apps/conductor` 追加時は `build:conductor` / `test:conductor` を追加し、Symphony 削除時は `:symphony` 系を消すだけ。`dev:*` namespace は orchestrator 切り替えとは独立して残る。

---

## 変更内容

### 1. ルート `package.json` の scripts 書き換え

**変更前:**

```json
{
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "build:elixir": "cd apps/symphony && mix build",
    "test:elixir": "cd apps/symphony && mix test",
    "e2e": "./scripts/e2e.sh"
  }
}
```

**変更後:**

```json
{
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
}
```

**変更点:**

- `build:elixir` → `build:symphony` (アプリ名と揃える)
- `test:elixir` → `test:symphony` (同上)
- `build` の意味を「TS only (`pnpm -r build`)」から「全アプリ」に変更
- `test` の意味を「TS only (`pnpm -r test`)」から「全アプリ」に変更
- `build:claude-app-server` / `test:claude-app-server` を新規追加
- `dev:install` を新規追加 (claude-app-server を `pnpm link --global` で PATH に通す)
- `dev:uninstall` を新規追加 (`pnpm uninstall -g claude-app-server` でグローバル symlink を解除)

### 2. `apps/claude-app-server/package.json` への `start` script 追加

開発中に claude-app-server を直接起動して JSON-RPC 疎通を手動確認したい場合用。`pnpm --filter claude-app-server start -- <opts>` で任意の場所から呼べる。

```diff
 "scripts": {
+  "start": "node dist/bin.js",
   "build": "tsc && chmod +x dist/bin.js",
   "test": "vitest run",
   "test:watch": "vitest",
   "lint": "oxlint src test",
   "format": "oxfmt src test",
   "format:check": "oxfmt --check src test"
 }
```

### 3. TODO.md 実行順 6 の書き換え

**変更前:**

```
## モノレポ統合

- [ ] `scripts/build_all.sh`（両アプリビルド）
- [ ] `scripts/install_dev.sh`（claude-app-server を PATH に通す）
- [ ] `scripts/e2e.sh`（受け入れテスト一発実行、ルート CLAUDE.md 参照）
- [ ] LICENSE 配置確認（Apache-2.0 をルートに）
```

**変更後:**

```
## モノレポ統合

- [ ] root `package.json` に `build` / `build:<app>` / `test` / `test:<app>` / `dev:install` / `dev:uninstall` scripts 追加
- [ ] `apps/claude-app-server/package.json` に `start` script 追加
- [ ] `scripts/e2e.sh`（受け入れテスト一発実行、ルート CLAUDE.md 参照）
- [ ] LICENSE 配置確認（Apache-2.0 をルートに）
```

### 4. ルート `CLAUDE.md` 落とし穴節の書き換え

「claude-app-server がインストールされていないと動かない」項のうち、`scripts/install_dev.sh` への言及を `pnpm dev:install` に置き換える。

**変更前(該当箇所):**

> 開発時は `apps/claude-app-server/dist/bin.js` をシンボリックリンクするか、`pnpm link` するか、`scripts/install_dev.sh` で対応。

**変更後:**

> 開発時は `pnpm dev:install` (内部で `cd apps/claude-app-server && pnpm link --global` を実行) で対応。アンインストールは `pnpm dev:uninstall`。

ルート `CLAUDE.md` の `scripts/e2e.sh` の中身サンプル節は実行順 8 で更新するため、本設計のスコープ外。

### 5. LICENSE 配置確認

ルート `LICENSE` (Apache-2.0) は既に配置済み。per-app LICENSE は配置しない (各アプリの `package.json` / `mix.exs` で `Apache-2.0` 明示済み)。チェックボックスを付けるだけで完了。

---

## 動作前提

- **`pnpm install` はユーザが事前実行**: `build:claude-app-server` 内で自動 install はしない。冗長な install を避けるため。
- **`mix deps.get` もユーザ責務**: `build:symphony` は `mix build` のみ。
- **`mix` / `pnpm` は PATH 上**: DevContainer + Nix Flake / direnv 環境前提。無ければ pnpm が標準エラーを返す。
- **`pnpm link --global` の global bin が PATH 上**: DevContainer では `~/.local/share/pnpm` 系が PATH に含まれる。無ければ Symphony 側で `System.find_executable("claude-app-server")` が `nil` を返し `{:error, {:backend_command_not_found, "claude-app-server"}}` で停止する (既存実装、Phase 1 で対応済み)。

## 冪等性とアンインストール

- `pnpm dev:install` (`pnpm link --global`) は再実行で symlink を上書き。エラーにはならない。
- `pnpm dev:uninstall` (`pnpm uninstall -g claude-app-server`) は対象が既に未 link でも `ERR_PNPM_CANNOT_REMOVE_GLOBAL` 系のエラーで終わる可能性あり (pnpm のバージョンと履歴に依存)。再現確認は実装時に行う。問題があれば `pnpm uninstall -g claude-app-server || true` でグレースフル化を検討。

## エラーハンドリング

- pnpm scripts の `&&` 連鎖で短絡停止。最初に失敗したコマンドの exit code が `pnpm` 経由で伝播。
- 個別のエラーメッセージは pnpm / mix が標準で出すものに委ねる。装飾は不要。

---

## テスト/検証

各 script を実機で 1 回ずつ動作確認するのみ:

1. `pnpm build:claude-app-server` → `apps/claude-app-server/dist/` に再ビルドされる
2. `pnpm build:symphony` → `apps/symphony/_build/` が更新される
3. `pnpm build` → 上記 2 つが順に走る
4. `pnpm test:claude-app-server` → vitest が走る
5. `pnpm test:symphony` → ExUnit が走る
6. `pnpm test` → 両方走る
7. `pnpm dev:install` → `claude-app-server` が `which claude-app-server` で見つかる
8. `pnpm dev:install` を 2 回連続実行 → エラーにならない (冪等)
9. `pnpm dev:uninstall` → `which claude-app-server` で見つからなくなる
10. `pnpm --filter claude-app-server start -- --help` → claude-app-server の `--help` 出力が表示される (start script の疎通確認)

自動テストは追加しない。pnpm script の wrapper は単純すぎてユニットテスト価値が低い。

## 影響範囲とリスク

### `pnpm test` の意味変更

既存 `pnpm test` は `pnpm -r test` = `apps/claude-app-server` の vitest のみだった。新仕様では `apps/symphony` の `mix test` も走る。

**既存呼び出しの確認結果:**
- `docs/superpowers/plans/*.md` 内の `pnpm test` 呼び出しはすべて historical (既に実行済みプラン)
- `apps/claude-app-server/README.md` / `apps/claude-app-server/CLAUDE.md` の `pnpm test` は app ディレクトリ内コンテキストでの呼び出し前提 (root semantics 変更の影響を受けない)
- CI / GitHub Actions 等の自動化なし

→ semantics 変更は安全。

### `pnpm build` の意味変更

同様。既存は `pnpm -r build` = claude-app-server のみ。新仕様では symphony も。同じく既存呼び出しに影響なし (`pnpm build` を root から走らせている箇所は無い)。

### `build:elixir` / `test:elixir` 削除

git log で参照箇所を確認した結果、これらは git 履歴上 root `package.json` 以外では使われていない。削除して問題なし。

---

## YAGNI スコープアウト

以下は意図的に含めない:

- **`pnpm install` の自動実行**: 冗長になりやすい。ユーザが必要に応じて `pnpm install` を別途実行する前提。
- **`mix deps.get` の自動実行**: 同上。
- **lint / format チェック**: TODO.md 実行順 6 のスコープ外。各アプリの `pnpm lint` / `pnpm format:check` は既に各 `package.json` に存在しており、root から `lint:<app>` を生やす必要性は低い。
- **`scripts/build_all.sh` / `scripts/install_dev.sh` の実体ファイル作成**: pnpm script に寄せる方針なので作らない。
- **per-app LICENSE**: ルート LICENSE で OK と判断済み。

---

## 完了条件

- [ ] ルート `package.json` の scripts が上記「変更後」と一致
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

---

## 参考資料

- TODO.md (実行順 6)
- ルート [`CLAUDE.md`](../../../CLAUDE.md)
- `apps/claude-app-server/package.json` (bin 定義)
- `apps/symphony/lib/symphony_elixir/codex/app_server.ex` (`System.find_executable/1` による PATH 解決)
