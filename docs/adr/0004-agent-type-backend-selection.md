# 4. `agent.type` で backend を選択する（Milestone 1）

## ステータス

Accepted

決定日: 2026-05-10

## コンテキスト

WORKFLOW.md（Symphony の設定ファイル）に backend 選択の仕組みを入れる必要がある。本家 Symphony は `codex.command` を起動するだけだが、concert では Codex と Claude のどちらを起動するかを設定で切り替えたい。

長期的には次のような野心的な機能が欲しい:

- **state 別 backend 切替**: 「実装フェーズは Claude Sonnet、レビューは Codex GPT-5、最終チェックは Claude Opus」のように issue の状態遷移に合わせて backend を切り替える
- **passthrough 機構**: `thread/start.params` に backend 固有の動的フィールドをマージできる仕組み
- **camelCase ↔ snake_case 変換**: backend ごとの命名規約差を吸収

しかし Phase 1 でこれを全部入れると複雑度が跳ね上がり、肝心の疎通が遅れる。まず一番素朴なケース（**1 つの WORKFLOW.md = 1 つの backend で固定**）を動かしてから、必要な拡張を後乗せしたい。

## 決定

Milestone 1 では **`agent.type` フィールド一発で backend を選択**する単純な仕組みのみ実装する。state 別切替・passthrough・camelCase 変換は Milestone 3 以降に延期する。

```yaml
agent:
  type: claude              # claude | codex（未指定なら codex で本家互換）
  max_concurrent_agents: 2
  max_turns: 10

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

codex:
  command: codex --config 'model="gpt-5.5"' app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy: { type: workspaceWrite }
```

選択ロジック:

- `agent.type: claude` → `claude.command` を起動
- `agent.type: codex` または未指定 → `codex.command` を起動（本家 Symphony 互換）

issue の状態遷移が発生しても subprocess は kill せず、同じ backend が issue 終了まで生存する。

Milestone 3 以降の拡張計画は [`TODO.md`](../../TODO.md) に記載する。

## 結果

- **良い影響**:
  - Phase 1 の実装範囲が大幅に縮小し、疎通テストまで早く到達できる
  - `agent.type` を未指定にすれば本家 Symphony の WORKFLOW.md がそのまま動く（移行コスト最小）
  - Symphony は `agent.type` だけ見て `command` を解決する単純な実装で済む
- **悪い影響 / トレードオフ**:
  - state 別 backend 切替を当てにした使い方は Milestone 3 以降まで待つ必要がある
  - 同一 issue 内で「軽量モデルで初動 → 重量モデルで仕上げ」の運用ができない
- **影響範囲**: `apps/symphony` の WORKFLOW.md パーサと subprocess 起動部、`docs/architecture.md` §6、`docs/workflow_md_schema.md`
