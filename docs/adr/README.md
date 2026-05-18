# Architecture Decision Records

`studio` モノレポの設計判断を記録するディレクトリ。

## 形式

[Michael Nygard 形式](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) の日本語版。テンプレートは [`0000-template.md`](0000-template.md) を参照。

- ファイル名: `NNNN-kebab-case-title.md`（4 桁ゼロパディング）
- 本文中の参照記法: `ADR-NNNN`
- 1 ファイル 1 判断
- 既存判断を覆す場合は新規 ADR を起票し、旧 ADR のステータスを `Superseded by ADR-NNNN` に書き換える

## 索引

| # | タイトル | ステータス |
|---|---|---|
| [ADR-0001](0001-adopt-monorepo.md) | モノレポ構成を採用する | Accepted |
| [ADR-0002](0002-codex-app-server-protocol.md) | Claude バックエンドを Codex App Server 互換サーバとして実装する | Accepted |
| [ADR-0003](0003-implement-protocol-subset.md) | プロトコルは Symphony が使うサブセットのみ実装する | Accepted |
| [ADR-0004](0004-agent-type-backend-selection.md) | `agent.type` で backend を選択する（Milestone 1） | Accepted |
| [ADR-0005](0005-backend-config-via-command-args.md) | backend 固有設定は `command` 引数に押し込む | Accepted |
| [ADR-0006](0006-claude-oauth-only.md) | Claude は Pro/Max OAuth 前提とし API キーを使わない | Accepted |
| [ADR-0007](0007-no-upstream-tracking.md) | 本家 openai/symphony への追従を放棄する | Accepted |
| [ADR-0008](0008-symphony-to-conductor-migration.md) | `apps/symphony` を最終的に廃棄し TypeScript 版 `apps/conductor` に置換する | Accepted |
| [ADR-0009](0009-pnpm-workspace-and-license.md) | pnpm workspace と Apache-2.0 でモノレポを統一する | Accepted |
| [ADR-0010](0010-workspace-per-issue.md) | workspace は issue 単位で共有し backend 切替でも使い回す | Accepted |
| [ADR-0011](0011-kamae-for-typescript.md) | TypeScript 側で kamae 原則を採用する | Accepted |
| [ADR-0012](0012-adr-format.md) | ADR は Michael Nygard 形式・`docs/adr/` 配下で管理する | Accepted |
| [ADR-0013](0013-tracker-block-split-by-kind.md) | `tracker:` ブロックを kind 別に分割する | Accepted |
| [ADR-0014](0014-symphony-owned-state-transitions.md) | state transition を Symphony 側に集約する | Accepted |
| [ADR-0015](0015-conductor-port-completion.md) | `apps/conductor` 化完了に伴う `apps/symphony` 廃止 | Accepted |
| [ADR-0016](0016-sensitive-wrapper-for-pii.md) | PII を `Sensitive<T>` wrapper で型レベル保護する | Accepted |
| [ADR-0017](0017-rebranding-to-studio.md) | Rebrand `babie/concert` → `babie/studio`, `apps/conductor` → `apps/perform` | Accepted |
