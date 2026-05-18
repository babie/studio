# 5. backend 固有設定は `command` 引数に押し込む

## ステータス

Accepted

決定日: 2026-05-10

## コンテキスト

各 backend には固有の設定がある:

- Claude: モデル名（`claude-opus-4-7` 等）、`--permission-mode`、システムプロンプト追加など
- Codex: モデル名（`gpt-5.5` 等）、`approval_policy`、`thread_sandbox` など

これらを WORKFLOW.md でどう表現するかには複数案がある:

1. **Symphony が backend ごとの設定スキーマを理解し、構造化フィールドとして持つ** — 例: `claude: { model: ..., permission_mode: ... }`
2. **`command` の引数文字列にそのまま押し込み、Symphony は中身を解釈しない** — 例: `command: claude-app-server --model claude-opus-4-7`

(1) を取ると Symphony が backend 固有の知識を抱える羽目になり、backend 追加・モデル追加のたびに Symphony を改修する必要がある。[ADR-0002](0002-codex-app-server-protocol.md) で「Symphony は backend を区別しない」と決めた方針とも整合しない。

ただし `thread/start.params` に乗る runtime 設定（`approval_policy`, `thread_sandbox`, `turn_sandbox_policy`）は JSON-RPC リクエスト経由で渡る性質上、引数では表現しにくい。これは Symphony が `codex:` ブロックから読んで `params` に載せる必要がある。

## 決定

backend 固有の設定（モデル名、permission-mode 等）は **`command` 引数として埋め込み**、Symphony は中身を解釈せずそのまま subprocess に渡す。

```yaml
claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

codex:
  command: codex --config 'model="gpt-5.5"' app-server
```

ただし `thread/start.params` に乗せる runtime 設定だけは例外で、Symphony が `codex:` ブロックから読んで `params` に載せる。これは `agent.type: claude` のときも同じものが乗り、claude-app-server は知らないフィールドを単に無視する。

```yaml
codex:
  command: codex ... app-server
  # 以下は thread/start.params に乗る
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy: { type: workspaceWrite }
```

## 結果

- **良い影響**:
  - Symphony に backend 固有の知識が漏れない（[ADR-0002](0002-codex-app-server-protocol.md) と整合）
  - 新モデル追加・新 backend 追加で Symphony を改修する必要がない
  - claude-app-server / codex 各々の CLI フラグ仕様変更が WORKFLOW.md だけで吸収できる
- **悪い影響 / トレードオフ**:
  - WORKFLOW.md でモデル名や設定値を間違えても Symphony は気付けず、backend 起動後に初めて検知される
  - `thread/start.params` 経由の runtime 設定だけ二重ルート（`codex:` ブロック直下）になり、構造に若干の歪みが生じる
- **影響範囲**: WORKFLOW.md スキーマ、Symphony の subprocess 起動部、`docs/workflow_md_schema.md`
