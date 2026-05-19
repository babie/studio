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

# ============================================================
# 8. Claude Code (native) と Codex (pnpm) のインストール
# ============================================================
# Claude Code はネイティブバイナリ版が公式推奨 (npm 版は deprecated)。
# 起動が速く、claude update で自動更新もできる。
echo "Installing Claude Code (native)..."
if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | bash
fi

# ~/.local/bin を .bashrc の PATH に追加 (非ログインシェルでも有効化)
# shellcheck disable=SC2016
if ! grep -q '.local/bin' ~/.bashrc; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >>~/.bashrc
fi
export PATH="$HOME/.local/bin:$PATH"

# Codex は pnpm でグローバルインストール
# (Nix の nodejs prefix は /nix/store なので npm -g は read-only エラー。
#  pnpm なら PNPM_HOME (~/.local/share/pnpm) にユーザ権限で入る。)
echo "Installing Codex (pnpm)..."
if ! command -v codex >/dev/null 2>&1; then
  mkdir -p "$PNPM_HOME"
  pnpm add -g @openai/codex
fi

echo "Agent CLI installation complete."

# ============================================================
# 9. Claude Code 用の初期ファイルを ~/.claude/ に配置
# ============================================================
# .devcontainer/.claude/ にあるテンプレートを ~/.claude/ にコピー。
# 既存ファイルは尊重する (cp -n) ので、login 後のユーザ変更や
# postCreateCommand.sh の手動再実行でも上書きしない。
if [ -d /workspace/.devcontainer/.claude ]; then
  echo "Seeding ~/.claude/ from .devcontainer/.claude/..."
  mkdir -p ~/.claude
  cp -Rn /workspace/.devcontainer/.claude/. ~/.claude/
fi

echo "Setup complete!"
