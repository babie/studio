# Milestone 4: リブランディング (`babie/concert` → `babie/studio`) — 設計書

**日付:** 2026-05-18
**対象:** [`TODO.md`](../../../TODO.md) Milestone 4
**前提:** [M3 Phase 7 完了](2026-05-18-m3-phase7-design.md) / [ADR-0015](../../adr/0015-conductor-port-completion.md)
**ステータス:** 設計確定、実装計画 (`writing-plans`) 着手待ち

---

## 背景

M3 で `apps/conductor` (TS) が `apps/symphony` (Elixir) を置き換え、モノレポは単一スタックに統一された。M4 以降は state 別 backend 切替、umbrella CLI (`apps/{compose,perform,mix}`)、ダッシュボード Web 化など機能拡張に入る。これらの作業はすべて新名称のファイルパス / package 名 / binary 名に依存するため、**M4 着手の最初の作業としてリブランディングを一括で実施する**。

また、これまでの開発で公開リポジトリに置くべきでなかった第三者著作物 (`docs/vendor/*`) が git 履歴に残ったままになっており、`babie/concert` が fork repo であるため GitHub の制限で private 化できない。リブランディングをフレッシュリポジトリへの移行として実施することで、公開履歴から第三者著作物を確実に排除する。

---

## 確定事項 (ブレストで決定)

| 項目 | 決定 | 理由 |
|---|---|---|
| 新 org / repo | `babie/studio` (public, Apache-2.0, 通常 repo) | 個人 fork の出自を維持。`cyfyapp` 側は将来の SaaS (`cyfyapp/score`) 専用に分離。`@babie/*` npm scope も据置 |
| Umbrella 名 | `studio` | `compose/perform/mix` の 3 工程を抱える「制作スタジオ」のメタファー。複合語 (`cyfystudio` 等) も組みやすい |
| サブアプリ名 | `apps/{compose,perform,mix}` | M3 計画から変更なし。M4 では `perform` のみ実体あり (旧 `conductor`)、`compose` / `mix` は M5+ で新規 |
| 移行方法 | フレッシュリポジトリ (履歴破棄) | `docs/vendor/*` を公開履歴に残さないことが最優先。filter-repo は漏れ検知が困難なため不採用 |
| 旧 repo 履歴 | `babie/concert-archive` (private 通常 repo) に mirror push → 旧 `babie/concert` を削除 | fork は private 化不可。新規 private repo にミラーすれば回避可能。GitHub Support 待ちが不要 |
| 除外ファイル | `docs/vendor/`, `SPEC.md`, `/workspace/memory/` (in-repo の旧 4 ファイル, **`~/.claude/projects/-workspace/memory/` の auto-memory とは別物**), `.github/media/symphony-demo.{mp4,jpg}` | 著作権リスク / 古い情報 / 別 home に居るべき auto-memory / ファイル名が陳腐化した demo |
| TODO.md 運用 | 進行中マイルストーン = spec へのリンク 1 行のみ | 進行中の詳細は spec に集約、TODO.md は俯瞰とポインタに専念 |

---

## スコープ

### in

- 新 `babie/studio` (public, Apache-2.0) の作成とフレッシュ初回 commit
- 旧 `babie/concert` の `babie/concert-archive` (private) への mirror push、その後旧 repo 削除
- `apps/conductor` → `apps/perform` のディレクトリ rename と全 import / binary / package 名修正
- `concert` / `conductor` / `Conductor` / `CONCERT_` 等のリポジトリ全体への語彙置換 (固有名詞を残す箇所は明示)
- DevContainer / docker-compose / flake.nix の name / default プロジェクト名更新
- 除外ファイル (`docs/vendor/`, `SPEC.md`, `memory/`, `.github/media/symphony-demo.*`) の新 repo からの排除
- README の `symphony-demo` 動画リンク部分をテキスト謝辞に置換 (動画は新 repo に含めない)
- ADR-0017 起票 (リブランディング決定)
- `docs/milestones/04-rebranding.md` 作成 (完了時に最終化)
- TODO.md 運用ポリシー切替 (進行中マイルストーン = spec リンク 1 行のスタイルに変更)
- memory `feedback-todo-md-policy.md` を新ポリシーに合わせて更新
- macOS ホスト側のプロジェクトディレクトリ移動 / Claude Code memory 移行手順
- OrbStack ボリュームの新環境への中身移行 (`babie-concert_home` → `babie-studio_home`)
- 新 DevContainer での `pnpm build` / `pnpm test` / `pnpm test:e2e` 緑確認

### out

- `apps/compose` / `apps/mix` の新規実装 (M5+ で別マイルストーン)
- umbrella CLI の subcommand 統合 (`studio perform <workflow>` 形式の実装) — M4 では `apps/perform` の単体 binary を維持し、umbrella CLI 自体は M5+ で追加
- `cyfyapp` org / `@cyfyapp` npm scope の取得 — M4 では実施しない (`cyfyapp/score` の必要性が出てから判断)
- state 別 backend 切替 / Web ダッシュボード / TUI snapshot 回帰検出 — 別マイルストーン
- ADR / `docs/superpowers/specs/` / `docs/superpowers/plans/` の本文中の "concert" / "conductor" 文字列置換 — **履歴ドキュメントなので原則そのまま残す**。新 ADR-0017 で「以後、新名称を使う」と宣言する形を取る

### 成功基準

- `babie/studio` が public で公開され、`pnpm install` / `pnpm build` / `pnpm test` / `pnpm test:e2e:claude-linear` / `pnpm test:e2e:claude-github` がすべて緑
- `babie/concert` が GitHub から削除済み、`babie/concert-archive` (private) に全 ref がミラーされている
- 新 repo に以下が存在しない: `docs/vendor/`、`SPEC.md`、`memory/`、`.github/media/symphony-demo.{mp4,jpg}`
- 新 repo で `git grep -i concert` / `git grep -E "(^|[^A-Za-z])conductor([^A-Za-z]|$)"` がヒットするのは以下のみ:
  - `docs/adr/` / `docs/milestones/` / `docs/superpowers/specs/` / `docs/superpowers/plans/` 配下の履歴ドキュメント
  - 新 ADR-0017 / `docs/milestones/04-rebranding.md` (リブランディング決定の根拠として明示的に旧名を残す)
  - README の謝辞・歴史パラグラフ
- 旧 OrbStack ボリューム `babie-concert_{home,nix}` が削除済み (移行完了後)
- 新 DevContainer で `claude` CLI が前回ログイン状態を保持 (= `~/.claude/` の OAuth トークンが新 home ボリュームに移行済み)
- ADR-0017 起票、`docs/milestones/04-rebranding.md` 記録、TODO.md / `feedback-todo-md-policy.md` memory が新ポリシーに更新

---

## Phase 分割

M4 は環境を跨ぐため 3 Phase に分け、spec 内で各手順を **Agent / User** の担当別に明示する。

| Phase | 担当 | 内容 | 環境 |
|---|---|---|---|
| **4a. リネーム & 中身整理** | Agent 主体 | `/workspace` 内のファイルをすべて新名称に書き換え、除外ファイルを削除、build/test 緑を確認 | 旧 DevContainer (`babie/concert` の `feat/m4-rebranding` ブランチ) |
| **4b. カットオーバー** | User 主体 + Agent 補助 | リポ作成 / mirror push / 旧 repo 削除 / macOS rename / OrbStack ボリューム移行 / 新 DevContainer 起動 | macOS ホスト + 旧/新 DevContainer |
| **4c. 新環境疎通確認** | Agent 主体 | 新 DevContainer 内で build/test/E2E 緑、grep で残置確認、ADR-0017 / milestone 記録 finalize | 新 DevContainer (`babie/studio`) |

---

## Phase 4a: リネーム & 中身整理 (Agent 主体)

### 前提

- 旧 DevContainer (`babie/concert` の `/workspace`) で作業
- 新ブランチ `feat/m4-rebranding` を切る (`git switch -c feat/m4-rebranding`)

### Agent 作業 (ファイル変更)

#### A1. ディレクトリ rename

```bash
git mv apps/conductor apps/perform
```

#### A2. TypeScript import パスの一括更新

- `apps/perform/` 内の絶対 import (`#/` alias を使っていれば影響なし、相対 import は `git mv` で済む)
- `apps/perform/` を参照している外部 (`apps/e2e/` 等) の import: `from "../conductor/..."` → `from "../perform/..."`
- `package.json` の `dependencies` / `peerDependencies` で `conductor` を名指ししている箇所

#### A3. `apps/perform/package.json` 更新

- `name`: `conductor` → `perform` (npm scope なし、変えず)
- `bin`: `{ "conductor": "./dist/index.js" }` → `{ "perform": "./dist/index.js" }`
- `description` / `repository.url`: `concert` → `studio`、`babie/concert` → `babie/studio`

#### A4. ルート `package.json` 更新

- `name`: `concert` → `studio`
- scripts:
  - `build:conductor` → `build:perform`、`--filter conductor` → `--filter perform`
  - `test:conductor` → `test:perform` (同上)
  - `dev:install`: `cd apps/conductor && pnpm link --global` → `cd apps/perform && pnpm link --global`
  - `dev:uninstall`: `pnpm uninstall -g conductor` → `pnpm uninstall -g perform`

#### A5. `.devcontainer/` 更新

- `devcontainer.json`: `"name": "concert"` → `"name": "studio"`
- `docker-compose.yml`: `name: ${COMPOSE_PROJECT_NAME:-concert}` → `name: ${COMPOSE_PROJECT_NAME:-studio}`

#### A6. `flake.nix` 更新

- `description` / コメント内の `concert` 表記 → `studio`
- パッケージ追加・削除はなし

#### A7. ルートドキュメント sweep

- `README.md`: タイトル、最初のパラグラフ、リポジトリ構成、ステータス、ドキュメント節
- `CLAUDE.md`: 「このリポジトリは何」「モノレポにした理由」「ディレクトリ構成」「DevContainer」セクション
- `docs/architecture.md`: 全体像、コンポーネント、ライフサイクル
- `docs/protocol.md`: 序文、conductor 言及 → perform に
- `docs/e2e_testing.md`: 起動手順、log ファイル名
- `apps/perform/CLAUDE.md` / `apps/perform/README.md`: 内部命名 sweep
- `apps/claude-app-server/CLAUDE.md` / `apps/claude-app-server/README.md`: caller 名 `conductor` → `perform`
- `apps/e2e/` の README / 各 `workflow.*.md` / `config.json` の repo / project 参照

#### A8. `apps/e2e/config.json` 更新

```json
{
  "github": {
    "repo": "babie/studio",     // ← 旧: "babie/concert"
    "issueNumber": 1,
    ...
  }
}
```

`workflow.claude-github.md` の `project_owner: babie` は同じ owner なので変更なしだが、コメント / project 名表記に `concert` があれば置換。

#### A9. `apps/perform/examples/*` sweep

- `workflow.claude-*.md` / `workflow.codex-memory.md` 等の `workspace.root: /tmp/conductor/...` を `/tmp/studio/...` (または `/tmp/perform/...` のどちらかに方針統一、`/tmp/studio/` 推奨)
- コメント中の `conductor` 言及 → `perform` または `studio`

#### A10. 除外ファイル削除

```bash
# /workspace 配下で実行
rm -rf docs/vendor/
rm -f SPEC.md
rm -rf memory/                          # ← /workspace/memory/ (in-repo の旧 auto-memory 遺物)
                                        # ~/.claude/projects/-workspace/memory/ (本物の auto-memory) は触らない
rm -f .github/media/symphony-demo.mp4 .github/media/symphony-demo.jpg
```

#### A11. README の動画リンク部分書き換え

`.github/media/symphony-demo.mp4` リンク + ポスター画像を以下のようなテキスト謝辞ブロックに置換:

```markdown
> 本家 Symphony のデモ動画は [openai/symphony](https://github.com/openai/symphony) のリポジトリで参照できます。
> `studio` も同等のフローを Claude バックエンドで動かすことを目指しています。
```

#### A12. ADR-0017 起票

`docs/adr/0017-rebranding-to-studio.md` を新規作成。内容:

- Context: M3 完了で symphony 削除 → リブランディング機会
- Decision: `babie/concert` を `babie/studio` にフレッシュ移行、`conductor` → `perform`、`@babie/*` 維持
- Rationale: 個人 fork 維持、第三者著作物排除、umbrella CLI 計画の前提整備
- Consequences: 旧 commit hash 参照は dead に、過去 ADR 内 `concert/conductor` 表記は履歴として残す
- Alternatives considered: in-place rename / filter-repo / cyfyapp org 採用 / 別名 (`song`, `band` 等)
- Related: [ADR-0008](0008-symphony-to-conductor-migration.md), [ADR-0015](0015-conductor-port-completion.md)

`docs/adr/README.md` の ADR 一覧表にも追記。

#### A13. TODO.md 新スタイル切替

```markdown
# 実装 Todo

`studio` モノレポの実装タスク一覧。詳細は各 CLAUDE.md と各 spec を参照。

完了済みマイルストーンの記録は [`docs/milestones/`](docs/milestones/) を参照。

---

# Milestone 4: リブランディング (進行中)

詳細・チェックリスト: [`docs/superpowers/specs/2026-05-18-m4-rebranding-design.md`](docs/superpowers/specs/2026-05-18-m4-rebranding-design.md)

---

# Milestone 5 以降 (候補)

(既存の「Milestone 4 以降」セクションから M4 リブランディング項目を抜き、残りをここに移動 + 新名称に追従)
```

#### A14. `docs/milestones/04-rebranding.md` スタブ作成

完了時に最終化するためのスケルトン。Phase 4a/4b/4c 完了マークと振り返りを後で埋める。

### Agent 検証

- `pnpm install` 成功
- `pnpm build` 緑 (claude-app-server + perform)
- `pnpm test` 緑 (両アプリの unit/integration)
- `git grep -i concert` の残置確認 — 履歴ドキュメント (ADR, milestones, superpowers/) と ADR-0017 / `docs/milestones/04-rebranding.md` 以外でヒットしないこと
- `git grep -E "(^|[^A-Za-z])conductor([^A-Za-z]|$)"` の残置確認 — 同上
- `pnpm test:e2e` は **Phase 4c で実行** (実 Linear / GitHub 接続が要るため、旧 repo の test issue 削除タイミングと整合させる)

### Agent 成果物

`feat/m4-rebranding` ブランチに 1〜数 commit、build/test 緑。**この時点では `git push` しない** (Phase 4b の rsync 元として手元のファイル状態を維持)。

### User 確認ポイント (Phase 4a 完了時)

- ファイル一覧の sanity check (`docs/vendor/` / `SPEC.md` / `memory/` が消えていること)
- `git log --oneline -10` で commit メッセージが意図通りか
- `git grep -i concert` の出力をスキャンして「履歴ドキュメント以外」が残っていないこと

---

## Phase 4b: カットオーバー (User 主体 + Agent 補助)

各ステップで失敗したらどう戻すかを末尾の **ロールバック** に明記する。

### B1. `babie/concert` → `babie/concert-archive` (mirror push)

**担当: User** (macOS ホストまたは旧 DevContainer 内、`gh auth` が通っていればどちらでも)

```bash
# 1. 一時ディレクトリに mirror clone
git clone --mirror git@github.com:babie/concert.git /tmp/concert-mirror.git
cd /tmp/concert-mirror.git

# 2. 新規 private repo (通常 repo、fork ではない) を作成
gh repo create babie/concert-archive \
  --private \
  --description "Archive of babie/concert (predecessor of babie/studio). Contains historical commits including docs/vendor/* (do not redistribute)."

# 3. mirror push
git push --mirror git@github.com:babie/concert-archive.git
```

**確認** (User):
- GitHub UI で `babie/concert-archive` を開く
- ブランチ数 / タグ数 / 直近 commit が `babie/concert` と一致
- repo 設定の "This repository is private" が表示されている
- (重要) `docs/vendor/` がブラウザから閲覧できるが **private なので外部からは見えない**

**ロールバック**: 失敗時は `gh repo delete babie/concert-archive --yes` でアーカイブを削除し、`babie/concert` をそのまま残す。

### B2. `babie/studio` 作成 + 初回 push

**担当: User** (旧 DevContainer 内、Phase 4a 完了状態の `/workspace` で)

```bash
# 1. 新リポを GitHub に作成
gh repo create babie/studio \
  --public \
  --description "Personal orchestrator monorepo for Claude / Codex" \
  --license=Apache-2.0

# 2. /workspace から除外パターン付きで /tmp/studio-fresh にコピー
mkdir /tmp/studio-fresh
cd /workspace
rsync -av \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.direnv' \
  --exclude='docs/vendor' \
  --exclude='SPEC.md' \
  --exclude='memory' \
  --exclude='.github/media/symphony-demo.*' \
  --exclude='apps/e2e/backend.log' \
  --exclude='apps/e2e/symphony.log' \
  ./ /tmp/studio-fresh/

# 3. フレッシュ初回 commit
cd /tmp/studio-fresh
git init -b main
git add -A
git status                          # ← 意図しないファイルが入っていないか目視
git commit -m "init: babie/studio monorepo

See ADR-0017 for the rebranding decision and docs/milestones/04-rebranding.md
for the migration log."

# 4. push
git remote add origin git@github.com:babie/studio.git
git push -u origin main
```

**確認** (User):
- GitHub UI で `babie/studio` を開き、ファイル一覧をスクロール
- `docs/vendor/`, `SPEC.md`, `memory/`, `.github/media/symphony-demo.*` が **存在しない**
- LICENSE が Apache-2.0、README 冒頭が `studio` を名乗っている
- `apps/perform/` が存在し、`apps/conductor/` が存在しない

**ロールバック**: 不要な commit が混入していたら、`gh repo delete babie/studio --yes` してから手順を再実行。

### B3. macOS ホスト側のディレクトリ rename

**担当: User** (macOS ターミナル)

```bash
# 1. 旧 DevContainer を停止
devpod stop concert

# 2. プロジェクトディレクトリを mv (DevPod の流儀に応じて)
# 例: ~/projects/concert/ → ~/projects/studio/
cd ~/projects
mv concert studio

# 3. 新 repo を clone し直す (これが最も clean)
rm -rf studio
git clone git@github.com:babie/studio.git
cd studio
```

**注意**: `mv concert studio` 後にローカル `.git/config` の `origin` URL が古いままなので、`rm -rf studio` してから clone し直すのが推奨 (前ステップで完成した studio リポを取り直すだけ)。

#### B3.x Claude Code (macOS native) の memory ディレクトリ移行

macOS native の Claude Code を使っている場合のみ実施 (DevContainer 内専用なら不要)。

```bash
# 1. プロジェクト固有ストレージのパス確認 (Claude Code はパスをエンコードして保存)
ls ~/.claude/projects/ | grep -i concert
# 例: -Users-babie-projects-concert

# 2. 対応する新パスへ rename
mv ~/.claude/projects/-Users-babie-projects-concert \
   ~/.claude/projects/-Users-babie-projects-studio

# 3. Claude Code を再起動して新パスを認識させる
```

**確認** (User):
- 新パスで Claude Code を開いて過去の会話 / memory が引き継がれているか
- 引き継がれない場合は手動で `~/.claude/projects/-Users-babie-projects-studio/memory/` 配下に旧ファイルを cp する

**ロールバック**: rename 前にディレクトリの tar backup を取っておく (`tar czf ~/concert-claude-projects.tar.gz -C ~/.claude/projects -Users-babie-projects-concert`)。

### B4. OrbStack ボリュームの中身移行

**担当: User** (macOS ターミナル、Docker / OrbStack CLI が動く環境)

#### B4.1 旧 `home` ボリュームから tar export

```bash
# 旧 DevContainer は停止済み (B3 で実施済)
cd ~
docker run --rm \
  -v babie-concert_home:/data \
  -v $(pwd):/backup \
  alpine \
  tar czf /backup/concert-home.tar.gz -C /data .
```

**マウントの解説** (macOS にディレクトリを作らない確認):
- `/data` / `/backup` は **alpine コンテナ内部** のマウントポイント。コンテナは `--rm` で実行後即破棄されるので macOS には残らない
- `-v babie-concert_home:/data` = 旧 DevContainer の `home` Docker ボリュームをコンテナ内 `/data` に mount (読み取り元)
- `-v $(pwd):/backup` = macOS の現在ディレクトリ (`cd ~` 直後なので `/Users/<user>`) をコンテナ内 `/backup` に bind mount (書き出し先)
- 結果: tar.gz は **macOS の `~/concert-home.tar.gz`** に作られる
- macOS のルート直下 (`/data` 等) には何も作られない

**注意**: tar に含まれるもの (重要度順):
- `dev/.claude/` — OAuth ログイン状態、`projects/-workspace/memory/` の auto-memory
- `dev/.bashrc` / `dev/.zshrc` / `dev/.bash_history` / `dev/.zsh_history` — shell 設定
- `dev/.config/` / `dev/.local/` — 各種 CLI 設定 (gh, direnv 等)
- `dev/.codex/` — codex login state (`codex login` 済みなら)
- `dev/.gitconfig` — git user 設定

#### B4.2 新 DevContainer を一度起動して空ボリュームを作る

```bash
cd ~/projects/studio
devpod up .          # 新 babie-studio_home / babie-studio_nix が生成される
devpod stop studio   # 一旦停止
```

#### B4.3 新 `home` ボリュームに tar 展開

B4.1 と同じく、`/data` / `/backup` は alpine コンテナ内のマウントポイントで macOS には作られない (`--rm` で即破棄)。`$(pwd)` は B4.1 で `cd ~` した位置 (= `~/concert-home.tar.gz` のある場所) を引き継いでいる前提。

```bash
docker run --rm \
  -v babie-studio_home:/data \
  -v $(pwd):/backup \
  alpine \
  sh -c 'cd /data && tar xzf /backup/concert-home.tar.gz'
```

`/nix` ボリュームは移行しない。新 `babie-studio_nix` で初回 `direnv reload` 時に store が再ビルドされる (cache から大半引かれる)。

**確認** (User、新 DevContainer 起動後):
- `~/.claude/` が存在し、`claude` コマンドが login 不要で動く
- `~/.claude/projects/-workspace/memory/` の auto-memory ファイル群が揃っている
- `~/.bash_history` / `~/.zsh_history` が引き継がれている

**ロールバック**: `concert-home.tar.gz` を保管した状態でやり直し可能。失敗したら新ボリュームを削除 (`docker volume rm babie-studio_home`) → 再生成 → 再展開。

### B5. 新 DevContainer 起動 + 動作確認

**担当: User**

```bash
cd ~/projects/studio
devpod up .
devpod ssh studio
# コンテナ内
cd /workspace
ls -la ~/.claude/      # B4 で移行されたか確認
claude --version       # ログイン状態保持を確認
```

ログインが消えていた場合のみ:
```bash
claude login
```

### B6. 旧 `babie/concert` 削除 (Phase 4c 完了後に実施推奨)

**担当: User**

```bash
# Phase 4c で E2E 緑を確認してから
gh repo delete babie/concert --yes
```

**ロールバック**: 削除後の復元は不可。`babie/concert-archive` が無傷で残っていることが代替手段。

### B7. 旧 OrbStack ボリューム削除 (Phase 4c 完了 + 数日のソーク後)

**担当: User**

```bash
# 新環境で問題ないことを数日間確認してから
docker volume rm babie-concert_home babie-concert_nix
rm ~/concert-home.tar.gz   # tar アーカイブも不要なら
```

---

## Phase 4c: 新環境疎通確認 (Agent 主体、新 DevContainer 内)

新 DevContainer に入って Claude Code を起動した後、Agent が以下を実行。

### Agent 作業

#### C1. 依存解決 + ビルド

```bash
pnpm install
pnpm build
pnpm dev:install     # perform + claude-app-server を pnpm link --global
```

#### C2. ユニット / 統合テスト

```bash
pnpm test
pnpm --filter perform test
pnpm --filter claude-app-server test
```

#### C3. Linear / GitHub test issue の再セットアップ

**部分的に User 担当**:

- Linear: 既存 `CYFY-5` issue (旧 `babie/concert` repo 参照を含むなら) を `Todo` 状態にリセット、または新規 issue を studio 用に作成
- GitHub: `babie/studio` の issue #1 を作成 (`babie/concert#1` 相当)
  - Project board に追加 (Status field option `Todo` / `In Progress` / `Done` 用意)
  - 既存 GitHub Project が user-scoped なら issue の link 先を studio に切替
- `apps/e2e/config.json` の値が新 issue / repo と一致しているか再確認

Agent は config 更新支援、User は GitHub / Linear UI 操作。

#### C4. E2E テスト

```bash
pnpm test:e2e:claude-linear
pnpm test:e2e:claude-github
# まとめて
pnpm test:e2e
```

両方緑になることを確認。

#### C5. 最終 grep 確認

```bash
git grep -i concert
git grep -E "(^|[^A-Za-z])conductor([^A-Za-z]|$)"
git grep -i symphony   # M3 sweep の継続確認
```

ヒットしてよい場所:
- `docs/adr/` 配下 (履歴 ADR)
- `docs/milestones/` 配下 (履歴記録)
- `docs/superpowers/specs/` / `docs/superpowers/plans/` 配下 (履歴 spec / plan)
- 新 `docs/adr/0017-rebranding-to-studio.md` / `docs/milestones/04-rebranding.md` (改名決定の根拠記述)
- README 謝辞・歴史パラグラフ

それ以外でヒットしたら追加修正。

#### C6. ドキュメント finalize

- `docs/milestones/04-rebranding.md` を埋める (Phase 4a/4b/4c の完了マーク、所要時間、引っかかった点、振り返り)
- `docs/milestones/README.md` の表に M4 行を追記
- TODO.md の M4 セクションを削除 (`docs/milestones/04-rebranding.md` で記録、`feedback-todo-md-policy.md` の手順通り)
- TODO.md の M5 以降候補が新名称になっているか最終確認

#### C7. memory 更新

`/home/dev/.claude/projects/-workspace/memory/feedback-todo-md-policy.md` を新ポリシーに更新:

- 「進行中マイルストーンの **Phase ごとの実装チェックリスト**」 → 「進行中マイルストーン: spec へのリンク 1 行 (+ 任意で 1 行サマリ)」
- 「TODO.md 構造」を新スタイルに差し替え

`/home/dev/.claude/projects/-workspace/memory/MEMORY.md` の該当行を新タイトル / 新説明に追従。

---

## エラーハンドリング / 想定される失敗とリカバリ

| シナリオ | 起こりうる状況 | リカバリ |
|---|---|---|
| Phase 4a の build 失敗 | import path の取りこぼし、`package.json` の bin 名忘れ | `git status` / `git diff` で修正、再 build |
| `git mv apps/conductor apps/perform` の case-insensitive FS 警告 | macOS の APFS は case-insensitive、git の rename 検出失敗 | `git mv apps/conductor apps/perform-tmp && git mv apps/perform-tmp apps/perform` の 2 段階 |
| mirror push 中の認証エラー | SSH key / `gh auth` 設定が不十分 | `gh auth status` 確認 → `ssh-add` / `gh auth login` |
| `babie/studio` 作成済みでファイル間違い | `--public --license=Apache-2.0` のオプション漏れ | `gh repo edit babie/studio --visibility public` 等で修正、ライセンスは `LICENSE` ファイル commit で実質補完 |
| OrbStack ボリューム展開後に `~/.claude/` の権限が壊れる | tar の uid/gid 維持失敗 | `docker run --rm -v babie-studio_home:/data alpine chown -R 1000:1000 /data/dev` |
| 新 DevContainer 起動後に `claude login` がループ | `~/.claude/` の `.credentials.json` 等の権限破損 / バージョン不一致 | `mv ~/.claude/.credentials.json ~/.claude/.credentials.json.bak && claude login` |
| Claude Code macOS の memory ディレクトリ rename で過去会話が見えない | ディレクトリ名規則の差異 | 過去会話を諦めるか、ディレクトリ内容を新規プロジェクトにコピーして手動マージ |
| E2E が緑にならない | 新 GitHub Project の Status field option 未設定、Linear project_slug 不一致 | `apps/e2e/config.json` と Linear / GitHub UI 設定の整合性を再確認 |
| `babie/concert` 削除後に外部リンクが切れる | 個人 fork なので外部影響は小さいが、過去の Anthropic 内部 PR 参照等 | `babie/concert-archive` が補完 (private なので URL は変わる)。README に「過去 commit hash は archive 参照」と注記 |

---

## テスト方針

- **Phase 4a 終了時**: `pnpm install` / `pnpm build` / `pnpm test` 緑、`git grep` 残置確認
- **Phase 4b 終了時**: GitHub 上の studio リポにファイルが意図通り入っているか目視、archive リポにブランチ / タグ完全一致
- **Phase 4c 終了時**: `pnpm test:e2e:claude-linear` / `:claude-github` 緑、`git grep` で履歴ドキュメント以外にヒットなし
- **M4 完了判定**: `docs/milestones/04-rebranding.md` finalize、TODO.md / memory 更新済み、ADR-0017 起票済み、`babie/concert` 削除済み

---

## 落とし穴

### 履歴 ADR / spec を語彙置換しないこと

`docs/adr/0001-*.md` 〜 `0016-*.md` および `docs/superpowers/specs/*.md` / `docs/superpowers/plans/*.md` は **当時の決定** の記録。`concert` / `conductor` 表記は当時の事実なので原則そのまま残す。新 ADR-0017 で「以後 studio / perform を使う」と宣言し、過去 ADR は履歴として参照する形を取る。

例外: 過去 ADR / spec から **現行ドキュメントへの相対リンク** (例: `[`apps/conductor/CLAUDE.md`](...)` のような file:// リンク) は dead link になるので、ADR-0017 の note に「過去 ADR / spec のパス参照は babie/concert-archive の commit に紐づく、現行では apps/perform/CLAUDE.md 等に読み替える」と明示する。

### `apps/e2e/lib/common.ts` 内の caller 名

M3 Phase 7 で symphony 関連語を backend-neutral に rename したが、`Conductor` を冠した変数 / 関数名が残っている可能性。Phase 4a の sweep 対象。

### `bin` 名の global link 衝突

旧 `conductor` が `pnpm link --global` 済みの状態で新 `perform` を link すると、`conductor` が依然 PATH に残る。Phase 4a で `pnpm dev:uninstall` 相当を手順に組み込む (旧 binary の global link 削除)。

### macOS の case-insensitive FS

`git mv apps/conductor apps/perform` を case 違いだけで rename しようとすると失敗する (本ケースは別名なので非該当だが、`perform/PERFORM` 等の case 違いリネームは要注意)。

### GitHub Project の repo-scoped vs user-scoped

GitHub Projects (v2) で repo-scoped project を使っている場合、`babie/concert` 削除と同時に project も消える可能性 (要事前確認)。user-scoped project なら issue link が dead になるだけで project 自体は残る。Phase 4b で確認、必要なら新 studio repo に project を作り直す。

### npm scope は変えないが、bin 名は変わる

`@babie/*` scope は維持。ただし `bin: conductor` → `bin: perform` で global コマンド名が変わるので、ユーザー (= 開発者本人) のシェル alias / スクリプトに `conductor` 直叩きがあれば更新。`grep -rn 'conductor' ~/.{bashrc,zshrc,bash_profile,zshenv}` 程度の事前チェックを推奨。

---

## ロールバック全体方針

- **Phase 4a まで**: branch を捨てるだけ (`git checkout main && git branch -D feat/m4-rebranding`)
- **Phase 4b (B1〜B2)**: `gh repo delete babie/studio --yes` / `gh repo delete babie/concert-archive --yes` で新 / アーカイブ repo を消し、`babie/concert` をそのまま使い続ける
- **Phase 4b (B3〜B5)**: macOS 側のディレクトリ・ボリュームを旧名で復元 (`mv studio concert`、`babie-concert_home` は触っていないのでそのまま)
- **Phase 4b (B6) 後**: `babie/concert` 削除後はロールバック不可。`babie/concert-archive` から新 fork を作るか、archive のまま継続
- **Phase 4c**: E2E 失敗時は問題箇所を spec ベースで修正、リブランディング自体は完了済みなので戻さない

旧 repo (`babie/concert`) は **Phase 4c の E2E 緑まで削除しない** ことが最重要のセーフティネット。

---

## 完了条件

- [ ] Phase 4a〜4c 完了
- [ ] `babie/studio` が public で公開され、`pnpm build` / `pnpm test` / `pnpm test:e2e` 緑
- [ ] `babie/concert-archive` (private) に旧 repo の全 ref がミラーされている
- [ ] `babie/concert` が GitHub から削除済み
- [ ] 新 repo に `docs/vendor/` / `SPEC.md` / `memory/` / `.github/media/symphony-demo.*` が存在しない
- [ ] `git grep` で `concert` / `conductor` のヒットが履歴ドキュメントとリブランディング決定文書のみ
- [ ] 旧 OrbStack ボリューム `babie-concert_{home,nix}` が削除済み
- [ ] 新 DevContainer で `claude` CLI が前回ログイン状態を保持 (`~/.claude/` 移行成功)
- [ ] ADR-0017 (リブランディング決定) 起票
- [ ] `docs/milestones/04-rebranding.md` finalize、`docs/milestones/README.md` の表に追記
- [ ] TODO.md が新スタイル (進行中 = spec リンク 1 行)、M4 セクション削除済み
- [ ] memory `feedback-todo-md-policy.md` を新ポリシーに更新済み
