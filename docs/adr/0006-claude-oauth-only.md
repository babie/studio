# 6. Claude は Pro/Max OAuth 前提とし API キーを使わない

## ステータス

Accepted

決定日: 2026-05-10

## コンテキスト

claude-app-server は内部で Claude Agent SDK を呼び出す。Claude への認証方法は 2 通りある:

1. **`ANTHROPIC_API_KEY` 環境変数による API キー認証** — 従量課金
2. **Claude Pro / Max サブスクリプション認証** — Claude CLI が `~/.claude/` 配下に保存する OAuth トークンを利用、サブスクリプション枠内で利用

このプロジェクトの想定ユーザは Claude Pro / Max を購読している個人開発者。issue 1 件あたり数 turn のエージェント実行を日常的に回したいので、従量課金だとコスト予測が難しく心理的にも回しづらい。サブスクリプション認証ならフラットレートで安心して回せる。

一方、両者が同時に有効だと SDK が API キーを優先する挙動を持つことがあり、意図せず従量課金に流れる事故が起きうる。

## 決定

claude-app-server は **Claude Pro / Max サブスクリプション認証を前提**とし、API キーは使わない。

- Claude CLI が `~/.claude/` に置く OAuth トークンを Claude Agent SDK がそのまま読む
- 起動時に `ANTHROPIC_API_KEY` 環境変数があれば **明示的に unset** する（API キー経由の課金事故を防ぐため）
- `~/.claude/` 配下に認証ファイルが無ければ起動時に明確にエラーを返す

サブスクリプションのレート制限を踏まえ、WORKFLOW.md の `max_concurrent_agents` 推奨値は **2〜3** とする。本家 Symphony のデフォルト 10 は Pro/Max では厳しい。

## 結果

- **良い影響**:
  - 従量課金事故が原理的に発生しない
  - サブスクリプション枠内で利用できるためコスト予測が容易
  - 認証管理が Claude CLI に集約され、claude-app-server は OAuth トークンを直接扱わない
- **悪い影響 / トレードオフ**:
  - 法人ユースや API キー運用が必要な場面では使えない（必要になったら別 ADR で再検討）
  - `~/.claude/` の存在に依存するため、純粋にステートレスなコンテナ実行ができない
  - 同時実行数を絞る必要があり、大量 issue を一気にさばくユースケースには不向き
- **影響範囲**: `apps/claude-app-server` の起動処理、`docs/architecture.md` §5、ドキュメント全般の前提
