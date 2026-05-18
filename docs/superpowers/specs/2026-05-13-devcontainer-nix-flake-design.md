# DevContainer + Nix Flake 開発環境 設計書

**日付**: 2026-05-13
**対象**: `concert` モノレポ全体
**ステータス**: Draft (ユーザーレビュー待ち)

---

## 1. 目的と背景

### 目的

`concert` モノレポを **DevContainer + Nix Flake** で開発できるようにする。主目的は **Claude Code を permission なし (`--dangerously-skip-permissions` 相当) で安全に動かす隔離環境**を提供すること。

### 背景

- Claude Code を permission なしで動かすと、任意の `Bash` ツール呼び出しが許可される。ホスト環境で実行するのは危険なので、隔離された Linux 環境 (= コンテナ) を用意したい。
- 既存の `concert` モノレポは Elixir (`apps/symphony`) と TypeScript (`apps/claude-app-server`) を含み、Mac/Linux 両対応で開発される。
- 開発者 (`babie`) は DevPod on OrbStack on Mac で動かすが、他の人は **DevContainer 仕様準拠ならなんでも良い** (任意の DevContainer 対応クライアント)。
- エディタは **Zed**。VSCode/Cursor 拡張機能対応は不要。
- Nix Flake を採用する理由:
  - `flake.lock` で全員が同一バージョン (elixir 1.19 + erlang 28 + node + pnpm + 各種 CLI) を使える。
  - Dockerfile/Features よりキャッシュが切れにくく、再現性が高い (参考: `docs/vendor/devcontainer/ncaq-article.md`)。
  - 開発者個人の Nix エコシステムへの慣れ。

### 非目的 (Non-Goals)

- VSCode/Cursor 向けの拡張機能設定 (`customizations.vscode`) は提供しない。
- 本家 `openai/symphony` への追従。あくまで開発者個人の用途に最適化する。
- Multi-user mode の Nix daemon 運用 (DevContainer は systemd を持たないため不可能)。
- Claude Code 以外のエージェント (Codex 等) の隔離実行への最適化。ただし `codex` バイナリは E2E のため devShell に含める。

---

## 2. 全体構成

### 2.1 ディレクトリ構成

```
concert/
├── .devcontainer/
│   ├── devcontainer.json          # DevContainer 仕様
│   ├── docker-compose.yml         # サービス定義、ボリュームマウント
│   ├── Dockerfile                 # base image の vscode ユーザを dev にリネーム
│   └── postCreateCommand.sh       # Nix インストール + 設定 (冪等)
├── flake.nix                      # Nix Flake (devShell + packages)
├── flake.lock                     # ロックファイル (`nix flake update` で更新)
├── .envrc                         # direnv で flake をロード
└── .env.local                     # 個人秘密 (gitignore、CACHIX_AUTH_TOKEN 等)
```

### 2.2 起動シーケンス

```
[ホスト] DevContainer クライアントが .devcontainer/devcontainer.json を読む
    ↓
docker-compose up → ubuntu-24.04 ベース + Dockerfile (vscode → dev リネーム) のコンテナが起動
    ↓
named volume "nix-store-${devcontainerId}" が /nix にマウント
named volume "home-${devcontainerId}" が /home/dev にマウント
bind mount: ホストのリポジトリ → /workspace
    ↓
postCreateCommand: bash .devcontainer/postCreateCommand.sh
  - /nix の所有権を dev に
  - ~/.config/nix/nix.conf を書く
  - (CACHIX_AUTH_TOKEN があれば) ~/.config/nix/netrc を書く
  - Nix を --no-daemon でインストール (バージョン + sha256 固定)
  - .bashrc に nix profile と direnv hook を追加
  - nix profile add .#direnv .#nix-direnv .#nil
  - direnv allow (= cd するだけで devShell がロード)
    ↓
ユーザーがコンテナに入る → cd /workspace で devShell 自動ロード
    ↓
elixir / node / pnpm / claude / codex が利用可能
```

---

## 3. 各ファイルの仕様

### 3.1 `.devcontainer/devcontainer.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/devcontainers/spec/main/schemas/devContainer.schema.json",
  "name": "concert",
  "dockerComposeFile": "docker-compose.yml",
  "service": "dev",
  "workspaceFolder": "/workspace",
  "mounts": [
    "source=nix-store-${devcontainerId},target=/nix,type=volume",
    "source=home-${devcontainerId},target=/home/dev,type=volume"
  ],
  "postCreateCommand": "bash .devcontainer/postCreateCommand.sh",
  "remoteUser": "dev"
}
```

#### 設計ポイント

- **`customizations.vscode` を持たない**: Zed 利用のため不要。設定があっても害はないが、肥大化を避ける。
- **`workspaceFolder` は `/workspace`**: DevContainer 慣例 (`/workspaces/<name>`) より短く、プロジェクト名重複を避ける。プロンプトも短くなる。
- **`remoteUser: "dev"`**: base image のデフォルト `vscode` を Dockerfile でリネーム済み。uid は 1000 のまま。
- **`mounts` で `/nix` と `/home/dev` を named volume 化**:
  - `${devcontainerId}` を含めることでプロジェクトごとに独立。
  - `/home/dev` を named volume にすることで以下が永続化される:
    - `~/.claude/` (Claude Code OAuth トークン、セッション履歴)
    - `~/.bashrc` (Nix プロファイル、direnv hook)
    - `~/.config/` (nix.conf, direnv, gh 等)
    - `~/.local/share/pnpm/store/` (pnpm global store)
    - `~/.nix-profile/`, `~/.nix-defexpr/`, `~/.nix-channels/`
  - **ホストの `~/.claude/` とは独立**: コンテナ内で初回 `claude login` する必要がある。permission なし運用での隔離を保つ。

### 3.2 `.devcontainer/docker-compose.yml`

```yaml
services:
  dev:
    build:
      context: .
      dockerfile: Dockerfile
    user: dev
    command: sleep infinity
    env_file:
      - path: ../.env.local
        required: false
    volumes:
      - ..:/workspace:cached
```

#### 設計ポイント

- **`build:` で Dockerfile を参照**: base image (`mcr.microsoft.com/devcontainers/base:ubuntu-24.04`) の `vscode` ユーザーを `dev` にリネームするため。詳細は §3.3 Dockerfile 参照。
- **`user: dev`**: Dockerfile でリネーム後のユーザー。uid は 1000 のまま。
- **`env_file: ../.env.local`**: `CACHIX_AUTH_TOKEN` をホストから渡す経路。`required: false` で `.env.local` が無くても起動できる。
- **`volumes: ..:/workspace:cached`**:
  - ホストのリポジトリ全体を bind mount。`apps/claude-app-server/node_modules`、`apps/symphony/_build` 等もここに含まれる。
  - **`:cached` を付与**: macOS で読み込み優先 (write は後で sync) になり体感が向上。OrbStack の VirtioFS でさらに高速化される。
  - **`node_modules` 等の named volume 化はしない (初期方針)**: OrbStack の VirtioFS は十分速く、ホスト側 Zed から型定義等を辿れる利便性が大きい。pnpm global store は `/home/dev` の named volume に乗るので `pnpm install` のダウンロードキャッシュは永続化される。後で問題が出たら named volume 化を検討する。

### 3.3 `.devcontainer/Dockerfile`

```Dockerfile
FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG OLD_USER=vscode
ARG NEW_USER=dev

# vscode ユーザを dev にリネーム (uid/gid は 1000 のまま)
RUN usermod -l ${NEW_USER} ${OLD_USER} \
 && usermod -d /home/${NEW_USER} -m ${NEW_USER} \
 && groupmod -n ${NEW_USER} ${OLD_USER} \
 && if [ -f /etc/sudoers.d/${OLD_USER} ]; then \
      sed -i "s/${OLD_USER}/${NEW_USER}/g" /etc/sudoers.d/${OLD_USER} \
      && mv /etc/sudoers.d/${OLD_USER} /etc/sudoers.d/${NEW_USER}; \
    fi
```

#### 設計ポイント

- **`usermod -l`**: ユーザー名のみリネーム (uid 1000 は維持)。
- **`usermod -d /home/dev -m`**: ホームディレクトリを `/home/vscode` → `/home/dev` に移動 (`-m` 付与でファイルごと移動)。ただしこのホームは named volume が後でかぶせるため、中身は初回起動時に空になる。
- **`groupmod -n`**: 同名のグループもリネーム。
- **`/etc/sudoers.d/vscode`**: base image 由来の sudo NOPASSWD 設定。中身の `vscode` を `dev` に置換しつつファイル名もリネーム。これで `sudo` がそのまま使える (`postCreateCommand` の `sudo chown -R dev: /nix` が成功する)。
- **`ARG` でユーザー名を可変に**: 将来 `dev` 以外にしたくなったら `docker-compose.yml` の `build:` に `args:` で渡せる。今回は使わない。

### 3.4 `.devcontainer/postCreateCommand.sh`

参考記事のスクリプトをベースに、以下を反映:

- Nix バージョンとハッシュは記事の値 (Nix 2.31.2) を採用。後日 `nix flake update` の際に同期検討。
- Cachix セクションは **`CACHIX_AUTH_TOKEN` がセットされている時だけ有効になる条件分岐コードを残す** (記事準拠)。プライベートキャッシュを使う具体的なニーズは現状なし。将来 `.env.local` に `CACHIX_AUTH_TOKEN=xxx` を書くだけで有効化できる。
  - **キャッシュサーバ URL とトラスト鍵は `example.cachix.org` のままにせず、placeholder としてコメントアウト or リテラル `# YOUR_CACHE` で残置**。実際に使う時に書き換える。
- `nix profile add .#direnv .#nix-direnv .#nil` でグローバルインストール。
- `.bashrc` に以下を追加 (冪等):
  - Nix プロファイル読み込み
  - `direnv hook bash`
- スクリプト末尾で `eval "$(nix print-dev-env)"` + `direnv allow`。
- 全体を **冪等** に書く (`if ! grep -q ... then ...` パターン)。再実行で壊れない。

#### 設計ポイント

- **`--no-daemon` (シングルユーザーモード)**: DevContainer に systemd がないため必須。
- **バージョン + sha256 固定**: 再現性とサプライチェーン攻撃対策。
- **`.bashrc` を編集する**: VSCode 系ターミナルは非ログインシェルだが、Zed や DevContainer の `exec` 経由のシェルも基本的に bash 非ログインなので `.bashrc` が正解。
- **`nil` をグローバルインストール**: 記事のとおり、direnv 環境を認識できないクライアント向け保険。Zed の Nix 拡張がどう振る舞うかは未検証だが、副作用がないので入れておく。

### 3.5 `flake.nix`

```nix
{
  description = "concert: Symphony + claude-app-server monorepo";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        # erlang 28 + elixir 1.19 を beam パッケージから取得
        beamPkgs = pkgs.beam.packages.erlang_28;
        elixir = beamPkgs.elixir_1_19;
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # BEAM
            erlang_28
            elixir
            # Node / pnpm
            nodejs_22
            pnpm
            # エージェント CLI
            claude-code
            codex
            # 汎用ツール
            git
            gh
            curl
            jq
            ripgrep
            fd
            # シェル / coreutils は base image に含まれるので省略
          ];

          shellHook = ''
            # pnpm の global store を /home/dev 配下に固定
            export PNPM_HOME="$HOME/.local/share/pnpm"
            export PATH="$PNPM_HOME:$PATH"
          '';
        };

        # グローバルインストール用 (direnv 起動より前に必要なもの)
        packages = {
          direnv = pkgs.direnv;
          nix-direnv = pkgs.nix-direnv;
          nil = pkgs.nil;
        };
      });
}
```

#### 設計ポイント

- **`nixpkgs-unstable` を採用**: elixir 1.19 + erlang 28 は新しいバージョンなので unstable が必要。`flake.lock` で固定するので不安定リスクは限定的。
- **`packages` で direnv / nix-direnv / nil を公開**: postCreateCommand から `nix profile add .#direnv` 等で個別にグローバルインストールする経路。
- **`devShells.default` には direnv 等を含めない**: direnv 自身が devShell をロードするので循環してしまう。
- **`shellHook` で `PNPM_HOME` を固定**: pnpm のグローバル CLI (`pnpm add -g`) が `/home/dev/.local/share/pnpm` に入り、named volume で永続化される。
- **`coreutils`, `bash`, `gnused`, `gnugrep` を明示的に入れない**: base image に含まれる。devShell から落としても影響なし。
- **`claude-code` の入手元**: nixpkgs 上のパッケージ (実装時に正確なアトリビュート名 `pkgs.claude-code` を `nix search` で確認) を採用。バージョンは `flake.lock` 経由で固定。Anthropic の更新が頻繁な場合は `nix flake update` で追従。nixpkgs に存在しない / 古すぎる場合は、後段の代替手段 (npm 経由を `shellHook` か postCreateCommand で) を検討する。
- **`codex` も同様**: nixpkgs 上のパッケージ (`pkgs.codex` または `pkgs.codex-cli` 等) を `nix search` で確認。無ければ後段の代替手段。

### 3.6 `.envrc`

```bash
#!/usr/bin/env bash

# 開発時に使う共有環境変数 (もしあれば)
dotenv_if_exists .env

# ローカルカスタム (個人秘密、優先)
dotenv_if_exists .env.local

# Nix Flake をロード
use flake . --accept-flake-config
```

- ホストでも (Nix + direnv が入っていれば) 同じ Flake が使える設計。
- `.env` を読むのは将来的な共有環境変数を見越して。現時点では存在しないので no-op。

### 3.7 `.env.local` の扱い

- `.gitignore` に追加 (既存の `.gitignore` に追記)。
- 例として `.env.local.example` を用意するか? → 現時点では Cachix 以外に用途がないので作らない。`postCreateCommand.sh` のコメントで運用説明する。

---

## 4. 既存ファイルへの変更

### 4.1 `.gitignore`

以下を追加:

```
# DevContainer
.env.local

# direnv
.direnv/
.envrc.local
```

### 4.2 `apps/symphony/mise.toml`

**変更なし**。`apps/conductor` が完成して `apps/symphony` を削除するまで残置する (CLAUDE.md の移行方針参照)。Nix Flake と二重管理になるが、ホストで mise を使う人 (本家 Symphony 流儀) のフォールバックとして残す。

`flake.nix` の `erlang_28` + `elixir_1_19` は `mise.toml` の `erlang = "28"` / `elixir = "1.19.5-otp-28"` とメジャー/マイナーまで整合させる。**パッチバージョン (`1.19.5`) の完全一致は best effort**: nixpkgs は通常 `elixir_1_19` までしか attribute を提供しないため、ロックされる正確なパッチバージョンは `flake.lock` 経由で決まる。両者の差が大きい場合 (例: mise 側 1.19.5 vs Nix 側 1.19.0) は、`mise.toml` 側を Nix のパッチバージョンに寄せる。

### 4.3 ルート `CLAUDE.md`

`## 落とし穴 (両アプリ共通の事情)` のあとに **DevContainer セクション** を追加する。

- DevContainer の起動方法 (DevContainer 仕様準拠の任意のクライアント)。
- `.env.local` で Cachix が有効化できること。
- 初回 `claude login` がコンテナ内で必要であること (ホストとは独立)。
- 想定外の Nix エラー時の対処 (`bash .devcontainer/postCreateCommand.sh` を手動再実行)。

### 4.4 ルート `README.md`

開発者向けに「DevContainer で開発するときの最短手順」を 5 行程度で追加。

---

## 5. テストと検証

### 5.1 受け入れ条件

1. `.devcontainer/` を含むブランチで DevContainer を起動 → `postCreateCommand` が完走する。
2. コンテナ内 `cd /workspace` で direnv が自動ロード、`elixir --version`, `node --version`, `pnpm --version`, `claude --version`, `codex --version` が全て成功する。
3. `cd apps/claude-app-server && pnpm install && pnpm build && pnpm test` が成功する。
4. `cd apps/symphony && mix deps.get && mix compile && mix test` が成功する。
5. コンテナを停止 → 再起動しても `/nix` と `/home/dev` の状態が保持されていて、`postCreateCommand` 再実行で副作用が出ない (冪等性)。
6. コンテナ内 `whoami` が `dev` を返す。`sudo -n true` で sudo NOPASSWD が動く。
7. `.env.local` に `CACHIX_AUTH_TOKEN=dummy` を書いて再起動すると、`~/.config/nix/netrc` が `chmod 600` で作成される。

### 5.2 検証環境

- 開発者の DevPod on OrbStack on Mac (Apple Silicon)。
- アーキテクチャ: linux/arm64。`claude-code`, `codex` 両方とも nixpkgs に arm64 build があることを `nix flake check` で確認。

### 5.3 受け入れテストの実行方法

```bash
# ホストで:
git switch feat/devcontainer
devpod up .

# コンテナ内で:
elixir --version && node --version && pnpm --version
claude --version && codex --version
(cd apps/claude-app-server && pnpm install && pnpm test)
(cd apps/symphony && mix deps.get && mix test)
```

---

## 6. 想定される失敗パターンと対処

| 症状 | 原因 | 対処 |
|---|---|---|
| `/nix is not writable` | named volume が root 所有で初期化された | `postCreateCommand.sh` の冒頭で `sudo chown -R dev: /nix` を実行 (記事準拠) |
| `nix: command not found` | `.bashrc` の Nix プロファイル読み込みが効かない | `bash .devcontainer/postCreateCommand.sh` を再実行 |
| `direnv: error /workspace/.envrc is blocked` | direnv allow されていない | `direnv allow` を手動実行 |
| `claude` の OAuth が切れる | `~/.claude/` の named volume が破損 or 削除された | コンテナ内で `claude login` し直し |
| Apple Silicon でビルドが遅い | arm64 バイナリが nixpkgs キャッシュにない | `cache.nixos.org` が arm64 もキャッシュしているはず。問題が出たら Cachix を有効化 |
| `nix flake check` で `claude-code` が見つからない | nixpkgs のバージョンが古い | `nix flake update nixpkgs` |

---

## 7. 将来の拡張 (Non-Goals だが記録)

- `apps/claude-app-server/node_modules` の named volume 化 (体感問題が出た場合)。
- `apps/symphony/_build`, `apps/symphony/deps` の named volume 化 (同上)。
- `customizations` の追加 (VSCode/Cursor 利用者が増えた場合)。
- Cachix のプライベートキャッシュ実利用 (CI で Nix ビルドを共有したくなった場合)。
- `apps/conductor` 完成後の `apps/symphony` 削除に伴う `mise.toml` 削除と `flake.nix` の Elixir 周辺の整理。
- multi-platform 対応 (`flake.nix` で linux/amd64 と linux/arm64 の両方を `nix flake check`)。

---

## 8. 参考資料

- `docs/vendor/devcontainer/ncaq-article.md` (DevContainer + Nix Flake 構築の元記事)
- 本家 DevContainer Spec: https://containers.dev/
- nixpkgs claude-code: `pkgs.claude-code`
- mise.toml の指定: `erlang = "28"`, `elixir = "1.19.5-otp-28"`
