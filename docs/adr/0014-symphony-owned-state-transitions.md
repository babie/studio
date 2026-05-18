# 14. state transition を Symphony 側に集約する

## ステータス

Accepted

決定日: 2026-05-15

## コンテキスト

本家 Symphony は backend (Codex) に `linear_graphql` 動的ツールを供給し、LLM がプロンプト指示に従って `issueUpdate` mutation を発行する設計だった。Milestone 1 の Claude backend 移植時点では、Claude 側でも同等のプロンプト (curl で issueUpdate を叩く手順) を埋め込む方式を踏襲していた。

Milestone 2 で GitHub Projects (v2) 対応を進めるにあたり、この方式は次の問題を抱えるようになった:

- backend ごとに Linear / GitHub 両 API クライアントを抱えるのは非合理 (`claude-app-server` には MCP 動的ツール機構が未実装)
- LLM が状態遷移を忘れる / 誤遷移するリスク
- 状態遷移ごとに LLM プロンプトに API 手順を埋め込むことで毎回トークンを消費
- GitHub Projects (v2) は Project / Field / Option / Item の id 解決が必要で、prompt に埋め込むには重い

## 決定

WORKFLOW.md に `tracker.doing_state` / `tracker.done_state` が指定されている場合、**Symphony orchestrator が `Tracker.update_issue_state/2` で直接 mutation する** ([ADR-0013](0013-tracker-block-split-by-kind.md) の共通フィールドに位置づけ)。

発火タイミング:

- **doing**: `spawn_issue_on_worker_host` で worker spawn が `{:ok, pid}` を返した直後
- **done**: `:DOWN reason == :normal` 受信 AND `last_codex_event == :turn_completed` AND refresh 後 issue が active states に居ない (三条件 AND)

mutation 失敗時は 3 試行 retry (250ms / 1s backoff) の後に warning ログのみで継続 (best-effort)。`doing_state` / `done_state` 未設定なら完全 no-op (本家 Symphony との後方互換維持、Linear ユーザの prompt 方式運用も継続可能)。

`linear_graphql` 動的ツールは legacy 経路として当面残す (M3 以降で議論)。LLM が prompt 指示通り先に Linear API を叩いた場合も、Symphony 側は refresh で current_state を取得して idempotent no-op になる。

詳細設計: [`docs/superpowers/specs/2026-05-15-m2-phase3-design.md`](../superpowers/specs/2026-05-15-m2-phase3-design.md)

## 結果

- **良い影響**:
  - LLM トークン削減 (状態遷移指示をプロンプトから削除可能)
  - 責務の明確化 (LLM = コード実装、Symphony = issue 操作)
  - 遷移忘れ・誤遷移リスクの排除
  - backend ごとの tracker クライアント実装が不要 (`claude-app-server` に MCP 動的ツールを後付けせずに GitHub 対応可能)
  - tracker kind 切替時、prompt の書き換えが不要になる
- **悪い影響 / トレードオフ**:
  - 「LLM が自律的に判断して状態を変える」ユースケース (例: 実装不能と判断して別ラベル付与) は backend 側で別途仕組みが必要
  - mutation 失敗時の recovery は best-effort (warning ログのみ)。起動時 sweep / polling 補正 / 失敗時コメントは M3 以降に送る
  - `linear_graphql` 経路と Symphony 経路の二重化が当面続く (M3 で legacy 撤去判断)
- **影響範囲**:
  - `apps/symphony/lib/symphony_elixir/orchestrator.ex` (`maybe_doing_transition/1` / `handle_backend_finished/2` / `attempt_done_transition/2` / `tracker_update_with_retry/2`)
  - `apps/symphony/lib/symphony_elixir/config/schema.ex` (`Tracker` embed の `doing_state` / `done_state`)
  - `apps/symphony/examples/workflow.claude-github.md` (Symphony 経路、curl 手順なし)
  - `docs/protocol.md` (`linear_graphql` 言及箇所に legacy 注記)
  - tracker mutation の責務に関わる将来判断
