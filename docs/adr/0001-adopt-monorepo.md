# 1. モノレポ構成を採用する

## ステータス

Accepted

決定日: 2026-05-10

## コンテキスト

`concert` は OpenAI 製の Symphony をフォークし、Codex/Claude を切り替えられるエージェント・オーケストレーターとして再構築するプロジェクト。実装は以下 2 アプリにまたがる:

- `apps/symphony` (Elixir): tracker のポーリング・workspace 管理・backend subprocess の起動
- `apps/claude-app-server` (TypeScript): Codex App Server 互換の JSON-RPC サーバ

両アプリは独立したツールチェーン（mix と pnpm）と独立したテストスイートを持つ。一方で次の理由から、リポジトリは 1 本に揃えたかった:

- 受け入れテストで「両方ビルド→両方起動→疎通確認」を一発で回したい
- プロトコル仕様・WORKFLOW.md スキーマ等のドキュメントを共通管理したい
- プロトコルや WORKFLOW.md スキーマを変更するとき、両側を同じコミットで変更したい
- バージョンを揃え、関係する変更をまとめて追跡したい

## 決定

`concert` を pnpm workspace ベースのモノレポとして構成し、両アプリを `apps/` 配下に置く。

```
concert/
├── apps/
│   ├── symphony/             # Elixir
│   └── claude-app-server/    # TypeScript
├── docs/                     # 両アプリ共通ドキュメント
└── e2e/                      # E2E テスト等
```

ただし**コードレベルでは両アプリは独立**させる:

- 相互の import は行わない
- 通信は subprocess + stdio JSON-RPC のみ
- ビルドツールチェーンは独立

## 結果

- **良い影響**:
  - プロトコルや WORKFLOW.md スキーマの変更が単一コミットで完結する
  - `pnpm test:e2e` で両アプリのビルド〜疎通テストを 1 コマンドで実行できる
  - ドキュメントを `docs/` に集約でき、両アプリから参照可能
- **悪い影響 / トレードオフ**:
  - Elixir と TypeScript が同居するので CI 設定がやや複雑
  - リポジトリのトップレベル `package.json` と `mix.exs` 配下の依存関係が混在し、初見ユーザに学習コストが発生
- **影響範囲**: リポジトリ全体の構成、CI、開発手順
