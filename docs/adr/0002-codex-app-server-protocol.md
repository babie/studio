# 2. Claude バックエンドを Codex App Server 互換サーバとして実装する

## ステータス

Accepted

決定日: 2026-05-10

## コンテキスト

OpenAI 製の Symphony は Codex 専用オーケストレーターとして設計されており、backend には Codex CLI の `app-server` サブコマンドを subprocess として起動する。両者は stdin/stdout に JSON-RPC 2.0 (JSONL) を流して会話する。

このプロジェクトでは Claude を backend として使いたい。素直に考えると Symphony 側に「Claude 用クライアント」を実装することになるが、調査の結果**Codex App Server は OpenAI 専用ではなく、JSON-RPC 2.0 stdio のオープンプロトコル**であることが分かった。

つまり「Symphony が backend に対して投げる JSON-RPC を Claude 側でも受けられるサーバ」を作れば、Symphony 側からは backend の違いを区別する必要がなくなる。

候補となる選択肢:

1. **Symphony を直接 Claude 対応にする** — Symphony 内部に backend 抽象を導入し、Codex と Claude を分岐
2. **Codex App Server 互換サーバを Claude 側に作る** — Symphony は backend を区別せず、subprocess の起動コマンドだけ切り替える

(1) は Symphony 側に backend 知識が漏れ、追加 backend のたびに Symphony を改修する必要がある。(2) なら Symphony 側の改修は subprocess 起動コマンドの切替のみで済み、将来別の backend を追加するときも同じパターンで増やせる。

## 決定

Claude バックエンドは **Codex App Server 互換の JSON-RPC サーバ**として `apps/claude-app-server` に実装する。Symphony からは Codex CLI と同じインターフェースで起動・通信できるようにする。

通信は以下に統一する:

- 通信路: subprocess の stdin/stdout
- フォーマット: JSON-RPC 2.0 を JSONL（1 行 1 メッセージ、改行区切り）で交換
- Symphony 側は「backend は Codex App Server プロトコルを喋る subprocess」として扱い、内部実装の違いを意識しない

## 結果

- **良い影響**:
  - Symphony 側の改修が最小化される（subprocess 起動コマンドの切替のみ）
  - 将来 Gemini など別 backend を追加する際も同じパターンで増やせる
  - Codex CLI と claude-app-server が同じプロトコルで動くので、E2E テストや疎通確認の手順が backend 共通で書ける
- **悪い影響 / トレードオフ**:
  - Codex App Server プロトコルが OpenAI 側で破壊的変更を受けた場合、追随が必要
  - 「Claude 用に最適化したプロトコル」を独自定義する自由を放棄する
  - プロトコル仕様は OpenAI 側にあり、ドキュメントが OpenAI 都合で動く
- **影響範囲**: `apps/claude-app-server` の実装方針全般、Symphony の backend 起動部
