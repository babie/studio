# 9. pnpm workspace と Apache-2.0 でモノレポを統一する

## ステータス

Accepted

決定日: 2026-05-10

## コンテキスト

モノレポ採用を決めた（[ADR-0001](0001-adopt-monorepo.md)）後、技術選定として:

- **JavaScript パッケージマネージャ**: npm / yarn / pnpm のどれを使うか
- **ライセンス**: Apache-2.0 / MIT / 独自など、ルートと各アプリでどう揃えるか

選定理由:

- pnpm: workspace 機能の出来が良く、ディスク使用量が npm/yarn より少ない。シンボリックリンクベースで monorepo の依存管理が高速。開発者の他プロジェクトでの利用実績あり
- Apache-2.0: 本家 `openai/symphony` が Apache-2.0 で配布されており、フォーク継承が自然。MIT に変えるとライセンス互換性確認の手間と派生物表記の混乱が生じる

## 決定

- **パッケージマネージャ**: pnpm workspace を使う。ルートに `pnpm-workspace.yaml` を置き `apps/*` を workspace として登録する
- **ライセンス**: リポジトリ全体を Apache-2.0 に統一する
  - ルート `LICENSE` は Symphony 由来の Apache-2.0 を継承
  - `apps/claude-app-server` も Apache-2.0
  - 新規追加するアプリ（`apps/conductor` 等）も Apache-2.0

## 結果

- **良い影響**:
  - workspace 内パッケージ間の依存管理がシンプル
  - ディスク使用量と install 速度の最適化
  - ライセンスが統一されているのでファイル単位のヘッダ管理が単純（必要なら Apache 2.0 のヘッダを貼るだけ）
- **悪い影響 / トレードオフ**:
  - pnpm 固有の挙動（peerDependencies の strict 解決等）に開発者が慣れる必要がある
  - 将来 npm/yarn しか動かない CI 環境を使う場合に追加対応が必要
  - Apache-2.0 の派生物表記義務に縛られる（MIT の方が緩いが本家継承を優先）
- **影響範囲**: ルート `package.json` / `pnpm-workspace.yaml`、各 `LICENSE` ファイル、CI 設定
