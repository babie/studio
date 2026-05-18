# DevContainer + Nix Flake 開発環境 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code を permission なしで動かす隔離開発環境を、DevContainer + Nix Flake で構築する。

**Architecture:** `mcr.microsoft.com/devcontainers/base:ubuntu-24.04` をベースに、`vscode` ユーザを `dev` にリネームする Dockerfile を被せ、`/nix` と `/home/dev` を named volume で永続化。`postCreateCommand` が冪等に Nix インストール + direnv セットアップを行い、`flake.nix` の `devShells.default` で elixir / erlang / nodejs / pnpm / claude-code / codex / 各種 CLI を提供する。エディタは Zed 想定なので VSCode 拡張機能は持たない。

**Tech Stack:** DevContainer Spec, docker compose, Nix Flake (nixpkgs-unstable), direnv + nix-direnv, Ubuntu 24.04

**Reference Spec:** [docs/superpowers/specs/2026-05-13-devcontainer-nix-flake-design.md](../specs/2026-05-13-devcontainer-nix-flake-design.md)

---

## File Structure

新規作成ファイル:

| ファイル | 責務 |
|---|---|
| `.devcontainer/Dockerfile` | base image の `vscode` ユーザを `dev` にリネーム |
| `.devcontainer/docker-compose.yml` | サービス定義、bind mount、env_file |
| `.devcontainer/devcontainer.json` | DevContainer 仕様、named volume、postCreate |
| `.devcontainer/postCreateCommand.sh` | Nix インストール + 設定 (冪等) |
| `flake.nix` | devShell パッケージ定義、globalインストール用 packages |
| `flake.lock` | Nix が自動生成 (手動編集不可) |
| `.envrc` | direnv が flake をロード |

既存ファイルへの変更:

| ファイル | 変更内容 |
|---|---|
| `.gitignore` | `.env.local`, `.direnv/`, `.envrc.local` 追加 |
| `CLAUDE.md` | 「DevContainer」セクションを追加 |
| `README.md` | DevContainer での開発の最短手順を追加 |

---

## Branch Strategy

このプランは feature branch `feat/devcontainer-nix` で進める (モノレポルートのCLAUDE.mdに従い「branchはモノレポ全体で1本」)。

---

### Task 1: feature branch を作成

**Files:**
- (なし、git 操作のみ)

- [ ] **Step 1: 現在の状態確認**

Run:
```bash
git status
git log --oneline -5
```
Expected: working tree clean、`e0e4e8a` (spec 修正コミット) が HEAD。

- [ ] **Step 2: feature branch 作成**

Run:
```bash
git switch -c feat/devcontainer-nix
```
Expected: `Switched to a new branch 'feat/devcontainer-nix'`

---

### Task 2: `.gitignore` 更新

**Files:**
- Modify: `.gitignore` (末尾に追記)

- [ ] **Step 1: 現状の `.gitignore` を確認**

Run:
```bash
cat .gitignore
```
Expected: 既存のエントリ (node_modules や _build 等) が見える。

- [ ] **Step 2: `.gitignore` の末尾に追記**

`.gitignore` の末尾に以下のセクションを追加 (Edit ツールで既存末尾行を文脈として置換):

```gitignore

# DevContainer / Nix
.env.local
.direnv/
.envrc.local
```

- [ ] **Step 3: 反映確認**

Run:
```bash
git diff .gitignore
```
Expected: 4 行の追加 (空行 + 3 エントリ) が見える。

- [ ] **Step 4: コミット**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
chore(repo): gitignore DevContainer / Nix artifacts

.env.local, .direnv/, .envrc.local を ignore。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `flake.nix` 作成

**Files:**
- Create: `flake.nix`

- [ ] **Step 1: `flake.nix` を作成**

`flake.nix` を以下の内容で新規作成:

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
          ];

          shellHook = ''
            # pnpm の global store を /home/dev 配下に固定
            export PNPM_HOME="$HOME/.local/share/pnpm"
            export PATH="$PNPM_HOME:$PATH"
          '';
        };

        # direnv 起動より前に必要なものをグローバルインストールするための packages
        packages = {
          direnv = pkgs.direnv;
          nix-direnv = pkgs.nix-direnv;
          nil = pkgs.nil;
        };
      });
}
```

- [ ] **Step 2: Nix が手元にあれば構文チェック**

ホストに `nix` がインストールされている場合のみ:
```bash
nix flake check --no-build 2>&1 | head -50
```
Expected: エラーなしで完了 (もしくは `claude-code` / `codex` のアトリビュート名違いを検出)。

ホストに `nix` がない場合、このステップはスキップ (DevContainer 起動時に検証される)。

- [ ] **Step 3: claude-code / codex のアトリビュート名を確認 (ホストに nix があれば)**

```bash
nix search nixpkgs/nixos-unstable claude-code 2>&1 | head -20
nix search nixpkgs/nixos-unstable codex 2>&1 | head -20
```
Expected: `legacyPackages.<system>.claude-code` および `legacyPackages.<system>.codex` (または `codex-cli` 等) が見える。

**アトリビュート名がズレていた場合**: `flake.nix` の `packages = with pkgs; [...]` の該当行を実在の名前に修正する (例: `codex` → `codex-cli`)。修正後 `nix flake check --no-build` を再実行。

- [ ] **Step 4: flake.lock を生成 (ホストに nix があれば)**

```bash
nix flake lock
ls -la flake.lock
```
Expected: `flake.lock` が生成される (約 3〜5 KB)。

ホストに nix がない場合: このステップはスキップ。`flake.lock` は DevContainer 起動後に `nix flake lock` で生成 → 別途コミットする。

- [ ] **Step 5: コミット**

```bash
git add flake.nix $([ -f flake.lock ] && echo flake.lock)
git commit -m "$(cat <<'EOF'
feat(repo): add Nix Flake for monorepo devShell

devShells.default で elixir 1.19 + erlang 28 + nodejs 22 + pnpm
+ claude-code + codex + 汎用 CLI を提供。direnv / nix-direnv / nil
は packages として公開し、postCreateCommand から nix profile add で
グローバルインストールする想定。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `.envrc` 作成

**Files:**
- Create: `.envrc`

- [ ] **Step 1: `.envrc` を作成**

```bash
#!/usr/bin/env bash

# 開発時に使う共有環境変数 (もしあれば)
dotenv_if_exists .env

# ローカルカスタム (個人秘密、優先)
dotenv_if_exists .env.local

# Nix Flake をロード
use flake . --accept-flake-config
```

- [ ] **Step 2: 構文チェック**

Run:
```bash
bash -n .envrc
```
Expected: 出力なし (構文 OK)。

- [ ] **Step 3: コミット**

```bash
git add .envrc
git commit -m "$(cat <<'EOF'
feat(repo): add .envrc to load Nix Flake via direnv

.env / .env.local を任意で読み込んだ後、use flake で
devShell を有効化する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `.devcontainer/Dockerfile` 作成

**Files:**
- Create: `.devcontainer/Dockerfile`

- [ ] **Step 1: ディレクトリ作成**

Run:
```bash
mkdir -p .devcontainer
```

- [ ] **Step 2: Dockerfile を作成**

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

- [ ] **Step 3: 構文 (linter 相当) チェック**

`hadolint` があれば:
```bash
hadolint .devcontainer/Dockerfile || true
```
無ければスキップ (実ビルドで検証する)。

- [ ] **Step 4: コミット**

```bash
git add .devcontainer/Dockerfile
git commit -m "$(cat <<'EOF'
feat(devcontainer): add Dockerfile to rename vscode user to dev

base image (devcontainers/base:ubuntu-24.04) の vscode ユーザを
usermod + groupmod で dev にリネーム。/etc/sudoers.d/vscode も
内容置換 + ファイル名変更して sudo NOPASSWD を維持する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `.devcontainer/docker-compose.yml` 作成

**Files:**
- Create: `.devcontainer/docker-compose.yml`

- [ ] **Step 1: docker-compose.yml を作成**

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

- [ ] **Step 2: YAML 構文確認**

`docker` が手元にあれば:
```bash
docker compose -f .devcontainer/docker-compose.yml config 2>&1 | head -30
```
Expected: パースされた compose 設定が出力される。エラーなし。

無ければ:
```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.devcontainer/docker-compose.yml'))" && echo OK
```
Expected: `OK`

- [ ] **Step 3: コミット**

```bash
git add .devcontainer/docker-compose.yml
git commit -m "$(cat <<'EOF'
feat(devcontainer): add docker-compose.yml for the dev service

build: で隣接 Dockerfile を参照、user: dev で実行、
.env.local を required:false で読み、リポジトリ全体を
/workspace:cached に bind mount。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `.devcontainer/devcontainer.json` 作成

**Files:**
- Create: `.devcontainer/devcontainer.json`

- [ ] **Step 1: devcontainer.json を作成**

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

- [ ] **Step 2: JSON 構文確認**

Run:
```bash
jq . .devcontainer/devcontainer.json > /dev/null && echo OK
```
Expected: `OK`

- [ ] **Step 3: コミット**

```bash
git add .devcontainer/devcontainer.json
git commit -m "$(cat <<'EOF'
feat(devcontainer): add devcontainer.json

workspaceFolder=/workspace、remoteUser=dev、
/nix と /home/dev を ${devcontainerId} スコープの named volume で
永続化、postCreateCommand.sh を起動時に実行。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `.devcontainer/postCreateCommand.sh` 作成

**Files:**
- Create: `.devcontainer/postCreateCommand.sh`

- [ ] **Step 1: postCreateCommand.sh を作成**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Cachix トークンを扱うのでデバッグログは明示的に切る
set +x

# ============================================================
# 1. /nix の権限修正
# ============================================================
# named volume が初めて作られた直後は root 所有なので、
# シングルユーザーモードの Nix が書き込めるよう dev に渡す。
if [ -d /nix ] && [ ! -w /nix ]; then
  echo "Fixing /nix permissions..."
  sudo chown -R dev: /nix
fi

# ============================================================
# 2. Nix のユーザグローバル設定 (nix.conf)
# ============================================================
if [ ! -f ~/.config/nix/nix.conf ] || ! grep -q "experimental-features" ~/.config/nix/nix.conf; then
  echo "Configuring Nix..."
  mkdir -p ~/.config/nix
  cat >~/.config/nix/nix.conf <<'NIXCONF'
experimental-features = nix-command flakes
accept-flake-config = true
substituters = https://cache.nixos.org https://nix-community.cachix.org
trusted-public-keys = cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY= nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs=
NIXCONF
  echo "Nix configuration complete."
fi

# ============================================================
# 3. Cachix 認証 (オプション)
# ============================================================
# .env.local に CACHIX_AUTH_TOKEN が設定されている場合のみ有効化される。
# プライベートキャッシュを使うときは以下の placeholder を実際の値に書き換える:
#   - CACHIX_CACHE_NAME: Cachix で作成したキャッシュ名
#   - CACHIX_PUBLIC_KEY: そのキャッシュの公開鍵 (cachix の管理画面で確認)
# 同時に nix.conf 側の substituters / trusted-public-keys にも追記すること。
if [ -n "${CACHIX_AUTH_TOKEN:-}" ]; then
  echo "Setting up Cachix authentication..."
  mkdir -p ~/.config/nix

  # netrc を一瞬でも緩い権限で作らないよう umask 077 で生成
  (
    umask 077
    cat >~/.config/nix/netrc <<EOF
machine YOUR_CACHIX_CACHE.cachix.org
  password ${CACHIX_AUTH_TOKEN}
EOF
  )

  if [ ! -f ~/.config/nix/nix.conf ] || ! grep -q "netrc-file" ~/.config/nix/nix.conf; then
    echo "netrc-file = ${HOME}/.config/nix/netrc" >>~/.config/nix/nix.conf
  fi

  echo "Cachix netrc configured."
else
  echo "CACHIX_AUTH_TOKEN not set. Skipping Cachix authentication."
fi

# ============================================================
# 4. Nix インストール (シングルユーザーモード、バージョン固定)
# ============================================================
NIX_VERSION=2.31.2
NIX_INSTALL_SHA256=078e2ffeddf6a9c1f22adf41458ccc46a58bb26911a9e01579645314f9982994

if ! command -v nix >/dev/null 2>&1; then
  echo "Nix not found. Installing Nix ${NIX_VERSION}..."
  curl -L "https://releases.nixos.org/nix/nix-${NIX_VERSION}/install" -o /tmp/nix-install.sh
  echo "${NIX_INSTALL_SHA256}  /tmp/nix-install.sh" | sha256sum -c -
  sh /tmp/nix-install.sh --no-daemon
  rm /tmp/nix-install.sh
  echo "Nix installation complete."
fi

# 現在のシェルに Nix プロファイルを読み込む
if [ -e ~/.nix-profile/etc/profile.d/nix.sh ]; then
  # shellcheck source=/dev/null
  . ~/.nix-profile/etc/profile.d/nix.sh
fi

# 非ログインシェル (VSCode/Zed/DevContainer exec) でも読まれるよう .bashrc に追加
# shellcheck disable=SC2016
if ! grep -q "nix-profile/etc/profile.d/nix.sh" ~/.bashrc; then
  echo "Configuring Nix profile for bash..."
  echo '[ -e "$HOME/.nix-profile/etc/profile.d/nix.sh" ] && . "$HOME/.nix-profile/etc/profile.d/nix.sh"' >>~/.bashrc
fi

# ============================================================
# 5. direnv / nix-direnv / nil をグローバルインストール
# ============================================================
# direnv は devShell に入れるだけだと devShell をロードする前に
# direnv 自身が無いという循環になるため、profile に入れる必要がある。
echo "Installing global packages via Nix profiles..."
if ! command -v direnv >/dev/null 2>&1; then
  nix profile add .#direnv .#nix-direnv
fi

# nil は direnv 経由だと一部エディタが拾えないことがあるためグローバルに入れる
if ! command -v nil >/dev/null 2>&1; then
  nix profile add .#nil
fi

echo "Global package installation complete."

# ============================================================
# 6. nix-direnv の設定
# ============================================================
if [ ! -f ~/.config/direnv/direnvrc ] || ! grep -q "nix-direnv" ~/.config/direnv/direnvrc; then
  echo "Configuring nix-direnv..."
  mkdir -p ~/.config/direnv
  cat >>~/.config/direnv/direnvrc <<'DIRENVRC'
# nix-direnv を有効化 (キャッシュで direnv reload を高速化)
source $HOME/.nix-profile/share/nix-direnv/direnvrc
DIRENVRC
  echo "nix-direnv configuration complete."
fi

# direnv hook を bash に追加 (非ログインシェル対応)
# shellcheck disable=SC2016
if ! grep -q "direnv hook bash" ~/.bashrc; then
  echo "Configuring direnv hook for bash..."
  echo 'eval "$(direnv hook bash)"' >>~/.bashrc
fi

# ============================================================
# 7. devShell を現在のシェルにロード + direnv allow
# ============================================================
echo "Building and exporting Nix development environment..."
eval "$(nix print-dev-env)"

echo "Allowing direnv for future shell sessions..."
direnv allow

echo "Setup complete!"
```

- [ ] **Step 2: 実行可能ビットを付与**

Run:
```bash
chmod +x .devcontainer/postCreateCommand.sh
```

- [ ] **Step 3: bash 構文チェック**

Run:
```bash
bash -n .devcontainer/postCreateCommand.sh && echo OK
```
Expected: `OK`

`shellcheck` があれば追加で:
```bash
shellcheck .devcontainer/postCreateCommand.sh || true
```
警告は許容 (元記事の `# shellcheck` ディレクティブを踏襲しているため)。

- [ ] **Step 4: コミット**

```bash
git add .devcontainer/postCreateCommand.sh
git commit -m "$(cat <<'EOF'
feat(devcontainer): add postCreateCommand for Nix + direnv setup

冪等な setup スクリプト。/nix の権限修正、nix.conf 作成、
Cachix 認証 (CACHIX_AUTH_TOKEN がある時のみ)、Nix 2.31.2 の
シングルユーザーモードインストール (sha256 検証付き)、
direnv / nix-direnv / nil のグローバルインストール、
.bashrc への hook 追加、direnv allow までを実行する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `CLAUDE.md` に DevContainer セクション追加

**Files:**
- Modify: `CLAUDE.md` (`## 落とし穴 (両アプリ共通の事情)` セクションの直前に挿入)

- [ ] **Step 1: 挿入場所を確認**

Run:
```bash
grep -n "^## " CLAUDE.md
```
Expected: `## 落とし穴 (両アプリ共通の事情)` の行番号が見つかる。

- [ ] **Step 2: セクションを挿入**

`## 落とし穴 (両アプリ共通の事情)` の **直前** に以下を追加 (Edit ツールで「## 落とし穴 (両アプリ共通の事情)」を含む大きなブロックを置換):

```markdown
## DevContainer (Nix Flake)

このリポジトリは **DevContainer + Nix Flake** で開発できる。Claude Code を `--dangerously-skip-permissions` で動かす際の隔離環境として用意したもの。

### 起動

任意の DevContainer 対応クライアント (DevPod, VS Code Remote-Containers, GitHub Codespaces 等) でリポジトリを開く。`postCreateCommand` が Nix + direnv をインストールして devShell をロードする。

```bash
# 例: DevPod の場合
devpod up .
```

### 想定構成

- ユーザ: `dev` (uid 1000、`vscode` を Dockerfile でリネーム)
- workspace: `/workspace` (リポジトリ全体を bind mount)
- 永続ボリューム: `/nix` と `/home/dev` (`${devcontainerId}` スコープ)
- 提供されるツール: `elixir`, `erlang`, `nodejs`, `pnpm`, `claude`, `codex`, `git`, `gh`, `jq`, `ripgrep`, `fd`, `direnv`, `nil`

### 初回ログイン

`~/.claude/` は **ホストとは独立** の named volume に乗っているので、コンテナ初回起動時に:

```bash
claude login
```

を実行する必要がある。

### Cachix を使いたい時

リポジトリルートに `.env.local` を作って:

```
CACHIX_AUTH_TOKEN=your-token-here
```

その上で `postCreateCommand.sh` 内の `YOUR_CACHIX_CACHE` を実際のキャッシュ名に書き換え、`nix.conf` の `substituters` / `trusted-public-keys` にもキャッシュ URL と公開鍵を追加する。

### トラブル時

`postCreateCommand.sh` は冪等に書かれているので、Nix 周りで何か壊れたら:

```bash
bash .devcontainer/postCreateCommand.sh
```

をコンテナ内で再実行すれば良い。

### Flake の更新

`flake.nix` を編集してパッケージを追加した場合:

```bash
cd /workspace
direnv reload   # nix-direnv が変更を検知してリビルド
```

`nixpkgs` 側を更新したい場合:

```bash
nix flake update nixpkgs
direnv reload
```

`flake.lock` の差分はコミットすれば他の DevContainer 利用者にも反映される。

---

## 落とし穴 (両アプリ共通の事情)
```

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(repo): document DevContainer + Nix Flake usage in CLAUDE.md

起動方法、想定構成、初回ログイン、Cachix 利用方法、
トラブル時の対処、Flake 更新手順を追加。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `README.md` に DevContainer クイックスタート追加

**Files:**
- Modify: `README.md` (適切なセクション、なければ末尾)

- [ ] **Step 1: 既存 README.md を確認**

Run:
```bash
cat README.md
```
Expected: 現在のセクション構成が見える。

- [ ] **Step 2: 「Development」セクションがあればその直後に、なければ末尾に追記**

挿入する内容:

```markdown
## DevContainer で開発する

このリポジトリは DevContainer + Nix Flake で開発できる。

```bash
# 例: DevPod を使う場合
devpod up .

# コンテナ内に入ったら初回のみ
claude login
```

ユーザ名は `dev`、workspace は `/workspace`。詳細は [`CLAUDE.md`](CLAUDE.md) と [`docs/superpowers/specs/2026-05-13-devcontainer-nix-flake-design.md`](docs/superpowers/specs/2026-05-13-devcontainer-nix-flake-design.md) を参照。
```

具体的な挿入位置は既存 README の構成次第。「Development」「Getting Started」など類似セクションがあればその直後、なければファイル末尾に追加する。

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(repo): add DevContainer quick start to README

devpod up . + claude login の最短手順を README に追加し、
詳細は CLAUDE.md / 設計書へ誘導する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: コンテナ起動による統合テスト

**Files:**
- (なし、検証のみ。問題があれば既存ファイルを修正してコミット)

これは **手動で実行する統合テスト**。実装プランの最後の検証ステップ。

- [ ] **Step 1: DevContainer を起動**

ホスト (Mac / OrbStack) で:

```bash
cd /Users/babie/src/github.com/babie/concert
devpod up .
```

Expected: コンテナがビルド・起動し、`postCreateCommand` が完走する (約 2〜5 分)。エラーログが出ないこと。

- [ ] **Step 2: コンテナに入る**

```bash
devpod ssh
```
Expected: プロンプトが `dev@<host>:/workspace$` になる。

- [ ] **Step 3: ユーザ・workspace の確認**

コンテナ内で:
```bash
whoami
pwd
sudo -n true && echo SUDO_OK
```
Expected:
- `whoami` → `dev`
- `pwd` → `/workspace`
- `SUDO_OK` が表示される (sudo NOPASSWD が機能)

- [ ] **Step 4: ボリュームマウントの確認**

```bash
mount | grep -E "/nix|/home/dev|/workspace"
ls -la ~ | head -5
ls -la /workspace | head -5
```
Expected:
- `/nix`, `/home/dev`, `/workspace` のマウントが見える
- ホームに `.bashrc`, `.profile`, `.nix-profile` 等が見える
- `/workspace` 配下にリポジトリの中身 (`apps/`, `docs/`, `flake.nix` 等)

- [ ] **Step 5: devShell の各ツールが動作することを確認**

```bash
elixir --version
node --version
pnpm --version
claude --version
codex --version
git --version
gh --version
direnv --version
nil --version 2>&1 || echo "nil exists"
```
Expected: すべて成功 (バージョン文字列が表示)。

- [ ] **Step 6: `apps/claude-app-server` のビルド・テスト**

```bash
cd /workspace/apps/claude-app-server
pnpm install
pnpm build
pnpm test
```
Expected: すべて成功 (既存の 145 tests がPASS)。

- [ ] **Step 7: `apps/symphony` のビルド・テスト**

```bash
cd /workspace/apps/symphony
mix deps.get
mix compile
mix test
```
Expected: すべて成功。

- [ ] **Step 8: 冪等性の確認**

```bash
bash /workspace/.devcontainer/postCreateCommand.sh
```
Expected: 「すでにある」「すでに設定済み」のメッセージのみで、副作用なく完了する。

- [ ] **Step 9: Cachix 条件分岐の確認**

ホストで `.env.local` を作って:
```bash
echo 'CACHIX_AUTH_TOKEN=dummy-token-for-test' > /Users/babie/src/github.com/babie/concert/.env.local
```

コンテナ内で `postCreateCommand.sh` を再実行:
```bash
bash /workspace/.devcontainer/postCreateCommand.sh
ls -la ~/.config/nix/netrc
grep "netrc-file" ~/.config/nix/nix.conf
```
Expected:
- `netrc` が `-rw-------` (600) で存在する
- `nix.conf` に `netrc-file = ...` の行がある

確認後、`.env.local` を削除して状態を戻す:
```bash
# ホストで
rm /Users/babie/src/github.com/babie/concert/.env.local
```

- [ ] **Step 10: 再起動後の永続化確認**

ホストで:
```bash
devpod stop
devpod up .
devpod ssh
```

コンテナ内で:
```bash
elixir --version
ls ~/.nix-profile/bin/elixir
cat ~/.bashrc | grep -E "nix-profile|direnv hook"
```
Expected: バージョンが表示され、`.bashrc` の Nix 関連行が残っていて、再 install が走っていない (Nix インストールログが出ない)。

- [ ] **Step 11: 問題があれば修正コミット**

統合テストで問題が見つかった場合、該当ファイル (`flake.nix`, `postCreateCommand.sh`, `Dockerfile` 等) を修正し、修正内容ごとに小さくコミットする (例: `fix(devcontainer): correct codex attribute name`)。問題がなければこの Step はスキップ。

---

### Task 12: PR / マージ

**Files:**
- (なし、git 操作のみ)

- [ ] **Step 1: コミット履歴を確認**

```bash
git log --oneline main..feat/devcontainer-nix
```
Expected: Task 2〜10 + (あれば Task 11 修正) のコミットが並ぶ。

- [ ] **Step 2: ユーザに完了報告 → PR or 直接マージの選択**

「実装完了。Task 11 統合テストの結果含めて、PR を作るか main に直接マージするか指示してください」と確認する。

---

## Notes

- 元の参考記事は `docs/vendor/devcontainer/ncaq-article.md`。Cachix の placeholder (`YOUR_CACHIX_CACHE`) はコメント内の指示通りに書き換えること。
- `flake.lock` は **ホストに nix がなければ Task 3 でコミットできない**。その場合は Task 11 Step 2 でコンテナに入ったあと `cd /workspace && nix flake lock` を実行し、ホスト側で `git add flake.lock && git commit -m "chore(repo): commit flake.lock"` する。これは Task 11 の一部として扱う。
- claude-code / codex の nixpkgs アトリビュート名が記事の予想と違っていた場合、Task 3 Step 3 で発見されるはず。実装者は実在の名前に合わせて `flake.nix` を修正してから次に進むこと。
- 統合テスト (Task 11) はホスト環境 (DevPod on OrbStack on Mac) に依存するため、agentic worker がリモートから実行するのは難しい。**Task 10 までを自動で実装 → Task 11 はユーザに手動実行を依頼** という流れが現実的。
