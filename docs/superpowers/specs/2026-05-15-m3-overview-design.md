# Milestone 3: `apps/conductor` (TS) — 全体概要設計書

**日付:** 2026-05-15
**対象:** [`TODO.md`](../../../TODO.md) Milestone 3
**ステータス:** 設計確定、Phase 1 着手待ち

---

## 背景

`apps/symphony` (Elixir) を TS で書き直し、モノレポを単一スタックに統一する。`apps/claude-app-server` (TS) と同じツールチェーン・テスト・型ベースで開発できるようにすることで、

- M4 以降の **state 別 backend 切替**・**skill カスタマイズ**・**Composer 連携**などの拡張で symphony と conductor の二重実装を避けられる
- claude-app-server 側との型・ロジック共有が将来できる（M3 では共有 package 化は行わず YAGNI）

を狙う。

このドキュメントは **M3 全体の輪郭**だけを記録する。各 Phase の実装詳細は Phase 着手時に `docs/superpowers/specs/YYYY-MM-DD-m3-phaseN-design.md` を新規執筆する（M2 と同じ運用）。

---

## スコープ

### スコープ in（M3 で移植する現 symphony 機能）

- WORKFLOW.md パーサ / config schema 検証
- `agent.type` による backend 切替（codex / claude、subprocess + JSON-RPC stdio）
- Tracker (Linear / GitHub / Memory)、状態自動遷移 (`doing_state` / `done_state` mutation)
- Workspace 管理（`git clone`、`workspace.hooks.before_run` / `after_create` / `before_remove`）
- Orchestrator: 並列実行・スケジューリング・リトライ・ターン終了判定
- CLI バイナリ `conductor`（escript 相当、`pnpm dev:install` でグローバルリンク）
- TUI ダッシュボード（ANSI、`status_dashboard.ex` 相当）
- prompt rendering (Liquid 互換)

### スコープ out（M4 以降に送る）

- **Web ダッシュボード**（symphony の `SymphonyElixirWeb.DashboardLive` 相当）
- **state 別 backend 切替・passthrough・camelCase 変換**（symphony でも未実装）
- skill カスタマイズ、ダッシュボード `current_command/model` 表示
- GitHub App 認証、PR-based 完了検知、`github_graphql` 動的ツール
- workspace を git worktree ベース
- ストリーミング・トークン使用量通知（claude-app-server 側の課題）

### 成功基準

1. `apps/conductor` 1 つで symphony の挙動と等価（`pnpm test:e2e:claude-linear` / `pnpm test:e2e:claude-github` が conductor 起動で緑）
2. `apps/symphony` ディレクトリ削除済み
3. `agent.type: codex` での本家互換動作を維持（個人ユースだが symphony 互換は保つ）
4. ルート CLAUDE.md / docs / README の参照先がすべて conductor に置換済み

---

## 横断指針

### TS スタック

`apps/claude-app-server` と揃えるのを基本とする。

| 領域 | ライブラリ | 備考 |
|---|---|---|
| Schema 検証 | **valibot** | claude-app-server と揃える。WORKFLOW.md / tracker API レスポンス / JSON-RPC ペイロードの境界検証 |
| Result 型 | **byethrow** | claude-app-server と揃える |
| CLI | **commander** | claude-app-server と揃える |
| テスト | **vitest** + in-source (`import.meta.vitest`) | internal helper も export 不要でテスト可能。`includeSource: ['src/**/*.{ts}']` を有効化 |
| Lint/Format | **oxlint / oxfmt** | claude-app-server と揃える |
| tsconfig 構造 | **ルート `tsconfig.base.json` + 各パッケージで `extends`** | 既存の `apps/claude-app-server/tsconfig.json` と暫定追加された `apps/e2e/tsconfig.json` を base 経由に統一。Phase 1 で実施 |
| YAML パース | **js-yaml** + `@types/js-yaml` | リポジトリ既存（`apps/e2e/lib/common.ts`）に揃える |
| Liquid テンプレート | **liquidjs**（M3 限定） | symphony の `Solid` (Elixir Liquid) を 1:1 移植する都合で採用。M3 完了後に方式自体を再検討する余地あり |
| Subprocess | Node 標準 `child_process` (spawn) | claude-app-server で実績あり |
| TUI | **vanilla ANSI** + 自前 helper（`picocolors` 程度） | `status_dashboard.ex` が ANSI escape + cursor home/clear の素朴な実装なので踏襲。Ink は React 依存になるので避ける |
| ロガー | TBD（自前 file logger or pino 等） | symphony の `log_file.ex` 相当。Phase 6 spec で決定 |

### 設計指針

リポジトリの `kamae` スキルに準拠（`/workspace/.claude/skills/kamae/`):

- discriminated unions + branded types で domain modeling
- boundary（WORKFLOW.md ロード、HTTP/JSON-RPC レスポンス、subprocess 入出力）で valibot 検証
- API キー等の PII を log / error message に乗せない
- 1 file = 1 module を原則とし、symphony の `orchestrator.ex` (1,826 行) や `status_dashboard.ex` (1,952 行) のような巨大ファイルはモジュール分割

### コード再利用（claude-app-server と conductor の橋渡し）

- JSON-RPC stdio クライアント / message 型は両者で重複しうるが、**M3 では当面 conductor 側に独自実装**。共有 package 化は M3 完了後に判断（YAGNI）

---

## モノレポ位置づけ・symphony との共存戦略

### `apps/conductor/` 新規作成

```
apps/conductor/
├── CLAUDE.md             # 開発指示書（Phase 1 着手時に書く）
├── README.md
├── package.json          # name: conductor
├── tsconfig.json
├── vitest.config.ts      # includeSource で in-source test 有効化
├── src/
│   ├── bin.ts            # commander エントリポイント
│   └── ...
├── test/                 # 統合・E2E 寄りのテストのみ。unit は in-source
└── examples/
    ├── workflow.claude-linear.md
    └── workflow.claude-github.md
```

### pnpm workspace 登録

- ルート `pnpm-workspace.yaml` の `packages` に `apps/conductor` を追加
- `bin.conductor: ./dist/bin.js` を `package.json` に宣言
- `pnpm dev:install` を symphony / claude-app-server / conductor を全部リンクする形に拡張（具体的な script は Phase 1 spec で）

### E2E スクリプトの段階的切替

- 既存: `apps/e2e/claude-linear.ts` / `apps/e2e/claude-github.ts` は `apps/symphony/bin/symphony` を起動
- **Phase 1 で先行リファクタ**: `apps/e2e/lib/common.ts` に backend command を中央化し、起動先を 1 箇所差し替えで切替可能にする
- **Phase 3 完了時**: linear E2E を conductor 起動に切替
- **Phase 4 完了時**: github E2E を conductor 起動に切替
- 切替期間中は **symphony と conductor の二系統が並行動作可能**な状態を維持し、挙動比較に使えるようにする

### symphony 削除（Phase 7）

- conductor が全 E2E を通している状態を確認後、`apps/symphony/` を削除
- ルート `CLAUDE.md` / `docs/architecture.md` / `docs/protocol.md` / `README.md` の symphony 参照を sweep
- `docs/milestones/03-conductor-port.md` を作成して M3 完了マーク
- `apps/symphony` を参照する `mise.toml` / pnpm script / GitHub Actions も同タイミングで削除

### Conductor と claude-app-server の関係

- 通信は変わらず **subprocess + JSON-RPC stdio**。Conductor が claude-app-server を import することは無い（symphony と同じ独立性を保つ）

---

## フェーズ分割（輪郭のみ、詳細は各 Phase 着手時に spec を書く）

| Phase | ゴール（成果物） | 主要対象 | 完了判定 |
|---|---|---|---|
| **1** | TS bootstrap + Memory tracker で in-process 1 issue happy path | `apps/conductor/` セットアップ、WORKFLOW.md パーサ、Config schema、CLI shell、Memory tracker、Mock backend、最小 orchestrator skeleton、`apps/e2e/lib/common.ts` backend command 中央化リファクタ、**ルート `tsconfig.base.json` 新設と `apps/claude-app-server` / `apps/conductor` / `apps/e2e` の `extends` 化** | `conductor examples/workflow.memory.md` で 1 issue を `Todo → Done` に内部遷移できる（実 subprocess 起動なし） |
| **2** | 実 backend (claude-app-server / codex) subprocess 管理 + Workspace 管理 | JSON-RPC stdio クライアント、`thread/start` / `turn/start` / `turn/interrupt`、子プロセスライフサイクル、`git clone` + `workspace.hooks.{before_run, after_create, before_remove}`、prompt builder (liquidjs)、AgentRunner 相当、**並行モデル方針の確定** | Memory tracker + 実 claude-app-server で 1 issue を実 backend に流し end-to-end で完了させられる（dashboard なし） |
| **3** | Linear tracker + 自動 state 遷移 + Linear E2E | Linear GraphQL クライアント、Tracker Linear adapter、`doing_state` / `done_state` mutation、`pnpm test:e2e:claude-linear` の起動コマンドを conductor に切替 | `pnpm test:e2e:claude-linear` が conductor 経由で緑 |
| **4** | GitHub tracker + GitHub E2E | GitHub GraphQL クライアント、ProjectMeta cache、Tracker GitHub adapter、起動時 validation、`pnpm test:e2e:claude-github` 切替 | `pnpm test:e2e:claude-github` が conductor 経由で緑 |
| **5** | TUI dashboard + observability | `status_dashboard.ex` 相当の ANSI レンダラ、token usage / throughput / sparkline、observability pubsub 相当の event bus、symphony と TUI 出力の snapshot 比較基盤 | TUI 出力が symphony と機能的に同等（描画項目・更新頻度・色分け） |
| **6** | 並列実行・リトライ・edge cases パリティ | `max_concurrent_agents` スケジューラ、retry backoff、ターン終了判定 (`turn/completed` + subprocess exit 統合)、異常系（exit ≠ 0、network 失敗、tracker API timeout）、ロガー (`log_file.ex` 相当) | symphony の対応する behaviour test を conductor 側で再現して緑 |
| **7** | apps/symphony 削除 + ドキュメント sweep | symphony ディレクトリ削除、CLAUDE.md / docs / README / mise.toml / pnpm script / CI を sweep、ADR-0015 (Conductor port) 起票、`docs/milestones/03-conductor-port.md` 作成 | M3 完了マーク、`pnpm test:e2e` 全件緑、`apps/symphony` への参照ゼロ |

### Phase 間の依存

- Phase 1 → 2 → 3 → 4 が直線（順送り）
- Phase 5 (TUI) は **Phase 4 完了後**に開始（dashboard が tracker 情報を読むので、Linear/GitHub adapter が揃ってからの方が整理しやすい）
- Phase 6 (並列・リトライ) は **Phase 5 完了後**に開始（Orchestrator 内部に大きな変更が入るため、TUI を先に固めた方が回帰検出しやすい）
- Phase 7 は全 Phase 完了後

---

## リスクと緩和策

| リスク | 影響 | 緩和策 |
|---|---|---|
| Orchestrator (Elixir GenServer + Supervisor 木) の Node.js への移植で並行モデルがずれる | Phase 6 でリトライ・並列スケジューリング・プロセス監視の挙動差が露呈し、引きずる | Phase 2 spec で **並行モデルの実装方針（plain async + 状態オブジェクト / actor-style library / XState など）を先に決定**し、Phase 6 で初めて触らない |
| TUI レンダラの描画 diff・スロットリング (`@minimum_idle_rerender_ms`、`@throughput_window_ms` 等) を移植で取りこぼし、見た目同等にならない | Phase 5 で symphony 比較作業がループ | Phase 5 spec で symphony と TUI 出力を snapshot 比較する仕組みを最初に用意する |
| Phase 3/4 の途中で E2E スクリプト切替時に旧 symphony と挙動差が出て切替が止まる | 移行期間が長期化 | `apps/e2e/lib/common.ts` に backend command を中央化する Phase 1 先行リファクタを必須化 |
| symphony の 240 tests 相当の振る舞いを取りこぼし、Phase 7 で削除した後に regression 発覚 | M3 完了が後ろにずれる | Phase 6 完了時点で symphony との E2E + 手動 smoke test を最後に通し、Phase 7 削除は **conductor 単独運用を 1 週間以上回した後**に実施 |
| Claude Pro/Max のレート制限で E2E 中の再実行が制約される | Phase 3/4 の動作確認が回しづらい | E2E の rate-limit リトライ・skip 条件を明示し、最低 1 回緑になることを基準とする |

---

## M3 内では決めず Phase 着手時の spec に委ねる項目

1. **Orchestrator の TS 並行モデル**（plain async / actor / XState / Effect 等）→ Phase 2 spec
2. **ファイルロガー実装**（自前 / pino / winston 等）→ Phase 6 spec
3. **claude-app-server と JSON-RPC 型を共有 package 化するか** → Phase 2 spec
4. **TUI 差分描画の最適化方針** → Phase 5 spec
5. **workspace E2E の SSH モード対応の扱い**（symphony の `ssh.ex` 移植要否）→ Phase 2 spec

---

## M3 完了後に検討（TODO.md Milestone 3 以降に追記）

1. **`@babie/` scope での npmjs 公開**
   - 前提: Conductor 完成 + Claude/Codex の API キー対応
   - 目的: pnpm dev:install ベース配布から脱却し、外部利用者も入れられるようにする
2. **prompt 構築方式の Liquid 依存見直し**（M3 では liquidjs で移植、完成後に方式自体を再検討）
3. **claude-app-server と Conductor の重複コード共有 package 化**（必要が見えてから）
4. **Web ダッシュボード**（M4+、LiveView 相当）
5. **state 別 backend 切替・passthrough**（既存 TODO 項目を継続）
6. **workspace を git worktree ベース**（既存 TODO 項目を継続）

---

## 参考資料

- ルート [`CLAUDE.md`](../../../CLAUDE.md)
- 既存 symphony 改造指示 [`apps/symphony/CLAUDE.md`](../../../apps/symphony/CLAUDE.md)
- 既存 claude-app-server [`apps/claude-app-server/CLAUDE.md`](../../../apps/claude-app-server/CLAUDE.md)
- [`docs/architecture.md`](../../architecture.md)
- [`docs/protocol.md`](../../protocol.md)
- M2 完了マーク [`docs/milestones/02-github-tracker.md`](../../milestones/02-github-tracker.md)
- **根拠 ADR**: [ADR-0008 symphony → conductor migration](../../adr/0008-symphony-to-conductor-migration.md)
- 関連 ADR: [ADR-0004 agent.type backend selection](../../adr/0004-agent-type-backend-selection.md)、[ADR-0013 tracker block split by kind](../../adr/0013-tracker-block-split-by-kind.md)、[ADR-0014 Symphony owned state transitions](../../adr/0014-symphony-owned-state-transitions.md)
