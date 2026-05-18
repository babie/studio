# 11. TypeScript 側で kamae 原則を採用する

## ステータス

Accepted

決定日: 2026-05-11

## コンテキスト

`apps/claude-app-server` は JSON-RPC 2.0 stdio サーバとして以下を扱う:

- 外部からの非構造化入力（JSON-RPC リクエスト）の検証
- 内部状態遷移（thread / turn のライフサイクル）
- Claude Agent SDK との非同期境界
- エラー応答の形式統一

これらを TypeScript で素朴に書くと、`any` 型・unchecked cast・例外スロー・null チェック漏れが入り込みやすい。サブセット実装とはいえ Symphony との疎通インターフェースなので、内部不整合は即座に E2E テストの失敗として顕在化する。

開発者が server-side TypeScript で実績のある設計原則として「kamae (構え)」を持っており、これは:

- discriminated union による状態モデリング
- branded types による意味のある型の区別
- Result 型によるエラーハンドリング
- 境界での schema バリデーション
- PII 保護

を中心に据えた一連の設計指針。Claude Code には `kamae` および `kamae-review` skill が用意されており、原則的な書き方への誘導と adversarial レビューが受けられる。

## 決定

`apps/claude-app-server`（および将来の `apps/conductor`）の server-side TypeScript コードでは **kamae 原則に従う**。

具体的には:

- 状態は discriminated union（`type: "running" | "completed" | ...`）でモデリングする
- 例外を投げる代わりに Result 型 (`{ ok: true, value } | { ok: false, error }`) を返す
- 外部からの JSON-RPC リクエストは zod 等の schema で境界バリデーションする
- 内部関数は検証済みの型を受け取る前提で書き、再検証しない
- PII（認証トークン・ユーザコンテンツ等）はログ・エラーメッセージに混入させない

実装中に判断に迷う場合は `kamae` skill を起動し、レビュー時には `kamae-review` skill で adversarial チェックを受ける。

## 結果

- **良い影響**:
  - 状態遷移バグが型レベルで弾かれる（`any` を介した値の漏れが減る）
  - JSON-RPC リクエストの不正な形状が境界で確実に検出される
  - エラーケースが Result 型として明示されるため、呼び出し側で取りこぼしにくい
  - kamae skill による自動レビューが効くようになる
- **悪い影響 / トレードオフ**:
  - 素朴な TypeScript より記述量が増える（discriminated union、Result 型の boilerplate）
  - SDK 呼び出し境界での型変換コードが追加で必要
  - 原則の理解前提の書き方なので、新規参加者にラーニングカーブが発生する
- **影響範囲**: `apps/claude-app-server` 全体の実装スタイル、将来の `apps/conductor` の設計、コードレビュー基準
