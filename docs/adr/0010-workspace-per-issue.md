# 10. workspace は issue 単位で共有し backend 切替でも使い回す

## ステータス

Accepted

決定日: 2026-05-10

## コンテキスト

Symphony は issue 1 件ごとに backend subprocess を起動し、その backend がリポジトリの作業ディレクトリ（workspace）でコード編集を行う。workspace の単位として複数の選択肢がある:

1. **backend ごとに workspace を持つ**: state 別 backend 切替時、新 backend に新 workspace を割り当てる
2. **issue ごとに 1 workspace、backend 間で共有する**: backend が切り替わっても同じディレクトリを使い続ける

(1) は backend 間が分離されるが、前 backend の作業内容を引き継ぐためにファイルコピーや git pull を介する必要がある。同じ issue を扱っているのに workspace が複数あると、ユーザから見て状況把握が難しい。

(2) は同じ作業対象（同じ issue / 同じブランチ）を共有するのが自然。backend 切替時の引き継ぎも、新 backend が単に同じディレクトリで作業を再開すればよい。コミット粒度・ブランチ命名のルールを WORKFLOW.md とプロンプトで規定すれば、git ブランチ経由で前 backend の作業状態がそのまま見える。

## 決定

**1 issue = 1 workspace** とし、その issue が終わるまで使い回す。backend が切り替わっても workspace は破棄しない。

- workspace ルートは `<workspace ルート>/<issue-id>/` に配置
- 初回作成時に `git clone --depth 1` でフルクローン（将来 [`TODO.md`](../../TODO.md) で `git worktree` ベースに移行予定）
- `workspace.hooks.after_create` があれば実行
- backend 切替時、新 backend は前任者が push したブランチを `git pull` して作業継続
- コミット粒度・ブランチ命名は WORKFLOW.md とプロンプトで規定

### `HOME` の扱い

backend は `~/.claude/` や `~/.codex/` の認証情報を読みに行く（[ADR-0006](0006-claude-oauth-only.md) 参照）ので、**Symphony は per-issue で `HOME` 環境変数を切り替えてはいけない**。workspace は `cwd` のみ切り替え、`HOME` はホストの `HOME` をそのまま継承する。

## 結果

- **良い影響**:
  - backend 切替時の作業引き継ぎが「同じディレクトリで続きから」で自然に行える
  - workspace 数 = issue 数で予測しやすい
  - ユーザが進捗を確認するときに 1 つのディレクトリと 1 つのブランチを見ればよい
- **悪い影響 / トレードオフ**:
  - 異なる backend が同じファイルツリーを触るため、コミットメッセージやファイル末尾の改行など細かい流儀差が混在する可能性がある
  - 初回作成で `git clone --depth 1` するためディスクと時間のコストが大きい（`git worktree` 移行で改善予定）
  - `HOME` をホスト共有するためテスト・CI 環境で workspace 隔離が完全には実現できない
- **影響範囲**: `apps/symphony` の workspace 管理ロジック、`docs/architecture.md` §4、将来の `apps/conductor` 実装方針
