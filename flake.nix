{
  description = "studio: perform + claude-app-server monorepo";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Node / pnpm
            nodejs_24
            pnpm
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
            # pnpm 11 以降は global バイナリが $PNPM_HOME/bin 配下に置かれる。
            # pnpm 10 互換のため $PNPM_HOME 自体も残す。
            export PNPM_HOME="$HOME/.local/share/pnpm"
            export PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"
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
