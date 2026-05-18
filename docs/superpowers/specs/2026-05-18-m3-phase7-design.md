# M3 Phase 7: `apps/symphony` 削除 + ドキュメント sweep — 設計書

**日付:** 2026-05-18
**対象:** [`TODO.md`](../../../TODO.md) Milestone 3 / Phase 7
**前提:** [M3 overview](2026-05-15-m3-overview-design.md) / [Phase 6 完了](2026-05-17-m3-phase6-design.md) / [ADR-0008](../../adr/0008-symphony-to-conductor-migration.md)
**ステータス:** 設計確定、実装計画 (`writing-plans`) 着手待ち

---

## 背景

Phase 6 で `apps/conductor` が並列スケジューラ / retry / 異常系 / file logger まで symphony parity を取り、`pnpm test:e2e:claude-linear` / `:claude-github` も conductor 駆動で緑になった。ADR-0008 が約束した「`apps/conductor` 完成後に `apps/symphony` を削除する」を実現するフェーズ。

TODO.md 上は当初「conductor 単独運用を 1 週間以上回した後に着手」と書いていたが、M4 でリブランディング (`apps/conductor → apps/perform`) + state 別 backend 切替 + prompt 構築方式見直しが入った瞬間に conductor は symphony から完全に diverge する。soak 期間中も「conductor が正、symphony を fallback」ではなく「両者がただ同居している」状態でしかなく、symphony を残す積極的理由は消滅する。**M4 直前の合流地点として Phase 7 を即着手し、M4 を 1 言語スタックでスタートする**ことを Phase 7 の目的とする。

---

## スコープ

### in

- `apps/symphony/` ディレクトリの一括削除 (Elixir 全コード、mix プロジェクト、bin/symphony、examples、test)
- ルート `package.json` の Elixir 系 script 削除 (`build:symphony` / `test:symphony`)、`build` / `test` aggregator から該当呼び出しを除去
- `test:e2e:setup` の cross-workspace 部分を `apps/e2e/package.json` 側に畳む
- `apps/e2e/lib/common.ts` の symphony 分岐削除 + `Symphony*` 命名を backend-neutral に rename
- `apps/e2e/claude-linear.ts` / `claude-github.ts` の呼び出し側追従
- `apps/conductor/scripts/diff-symphony-dashboard.ts` 削除
- `apps/conductor/test/integration/dashboard-parity.test.ts` 削除
- `apps/conductor/test/fixtures/dashboard/*.txt` (symphony golden) 削除
- `apps/conductor/test/fixtures/dashboard/*.json` (Phase 5 spec) 削除 (parity test とセットで消える)
- `flake.nix` から Erlang / Elixir 依存削除
- `.gitignore` の `apps/e2e/symphony.log` 削除
- `docs/architecture.md` / `docs/protocol.md` / `docs/e2e_testing.md` / ルート `CLAUDE.md` / `README.md` の symphony 参照 sweep
- `apps/conductor/CLAUDE.md` / `apps/claude-app-server/CLAUDE.md` の symphony 言及整理 (履歴コメントは保持、現状指示は更新)
- ADR-0008 の status を「Accepted (implemented in M3, see ADR-0015)」に更新
- ADR-0015 起票 (Conductor port completion / Symphony 削除)
- `docs/milestones/03-conductor-port.md` 新規作成、`docs/milestones/README.md` の表に追加
- TODO.md の Phase 7 entry 完了化、不要になった項目 (例: `CONCERT_E2E_BACKEND` 関連の言い回し) を sweep

### out

- ADR-0014 の rewrite (架構決定としては依然有効、orchestrator owner が conductor になっただけ。ADR 本文の "Symphony" 表記はそのまま残し、ADR-0015 に「ADR-0014 の owner は conductor 主導と読み替える」と一行注記する)
- M4 リブランディング (`conductor → perform`、`@babie → @cyfyapp` 等は M4 着手 1 commit 目に一括)
- conductor 自身の dashboard snapshot test 再構築 (削除後に「vitest 自動 snapshot で書き直すか」は M4+ で別途判断、TODO.md に項目追加)
- mise の使用方針見直し (`apps/symphony/mise.toml` は削除されるが、root にも mise.toml が無いことを再確認するに留め、新規導入はしない)

### 成功基準

- `pnpm install` が `apps/symphony` の不在で壊れない
- `pnpm build` が 2 app (`claude-app-server` / `conductor`) を 1 コマンドでビルドできる
- `pnpm test` が `apps/symphony` の Elixir test を呼ばずに緑
- `pnpm test:e2e` が `apps/e2e` 側にロジックを畳んだうえで両 tracker 共に緑
- `pnpm --filter conductor test` が `dashboard-parity.test.ts` 不在のまま全部緑
- `flake.nix` の `direnv reload` で Erlang/Elixir のダウンロードが走らない (DevContainer の起動時間短縮)
- 削除後にリポジトリ全体で `git grep -i "symphony"` してヒットするのは以下のみであることを確認:
  - `docs/milestones/` 配下 (履歴)
  - `docs/superpowers/specs/` 配下 (履歴)
  - `docs/adr/0008-*.md` / `0014-*.md` / `0015-*.md` (ADR 本文)
  - `docs/adr/README.md` の ADR 一覧
  - 新規 `docs/milestones/03-conductor-port.md` (このマイルストーン記録)

---

## 確定事項 (ブレスト結果)

### Soak 期間は撤廃

TODO.md の「1 週間以上」記述は元々 symphony fallback 前提の安全網。M4 で diverge 確定なので fallback 価値が消滅する。Phase 6 で behaviour parity test と E2E が緑なら **soak ゲートを撤廃して即削除**。

### Dashboard snapshot は完全に削除

`apps/conductor/test/fixtures/dashboard/` の golden / spec、`dashboard-parity.test.ts`、`diff-symphony-dashboard.ts` をすべて削除する。理由:

- Golden 8 ファイルは symphony の `status_dashboard.ex` から一度だけ capture した文字列。symphony 削除後はメンテナンスパスが無い (更新する元実装が消える)
- `dashboard-parity.test.ts` は byte-for-byte 一致を assert している。conductor 側で TUI の見た目を改良したくなった瞬間に golden を「正解」として更新せざるを得ず、test の意味が失われる
- TUI の回帰検出を残したいなら vitest の `toMatchSnapshot` で自動 snapshot に書き直すべきだが、それは Phase 7 では行わず TODO.md M4+ に項目追加

### `CONCERT_E2E_BACKEND` env var は削除

`apps/e2e/lib/common.ts` の `VALID_BACKENDS = ["symphony", "conductor"]` と `readBackendChoice()` を削除。`resolveBackendCommand` は conductor 固定値を返す純関数に縮退。E2E 利用者が backend を選ぶ意味は無くなる (M4 の `perform` rename も簡素化される)。

### Symphony* 命名は backend-neutral に rename

`apps/e2e/lib/common.ts` 内の以下を全部 rename する (機能はそのまま):

| 旧名 | 新名 |
|---|---|
| `SYMPHONY_LOG_PATH` | `BACKEND_LOG_PATH` |
| `SymphonySpawnFailed` | `BackendSpawnFailed` |
| `SymphonyExitedUnexpectedly` | `BackendExitedUnexpectedly` |
| `SymphonyTimedOut` | `BackendTimedOut` |
| `SymphonyOutcome` | `BackendOutcome` |
| `spawnSymphony` | `spawnBackend` |
| `runSymphonyUntilTerminal` | `runBackendUntilTerminal` |
| `apps/e2e/symphony.log` (ファイル) | `apps/e2e/backend.log` |
| `error: symphony spawn failed: ...` (メッセージ) | `error: backend spawn failed: ...` |

呼び出し側 (`claude-linear.ts` / `claude-github.ts`) も追従。

### `test:e2e:setup` の畳み込み方針

`apps/e2e/package.json` 側に **`test:setup` script** を新設し、root の `test:e2e:setup` は削除。`pnpm test:e2e` (root) は `apps/e2e` 配下の `test:setup` + `test` を順に呼ぶ。`dev:install` は 2 app の `pnpm link --global` のみなので、`apps/e2e/package.json` の中で `pnpm --filter conductor build` / `pnpm --filter claude-app-server build` + `pnpm link --global` を直接書く。**ただし `pnpm link --global` は workspace 外副作用なので root の `dev:install` は引き続き残す** (開発者が手動で E2E 以外の用途でも使うため)。

### ADR の扱い

| ADR | 扱い |
|---|---|
| ADR-0008 (Symphony to conductor migration) | ステータスを `Accepted` → `Accepted (implemented 2026-05-18, see ADR-0015)` に更新。本文はそのまま (歴史的記録) |
| ADR-0014 (Symphony-owned state transitions) | 本文の "Symphony" 表記はそのまま (ADR は不変)。ADR-0015 に「ADR-0014 の owner は現在 conductor」と注記 |
| ADR-0007 (No upstream tracking) | 変更なし (依然有効) |
| **ADR-0015 (新規)** | Conductor port completion / `apps/symphony` deprecation の記録 |

ADR は不変前提で運用しているので、`apps/symphony` 削除に合わせて既存 ADR の表記を書き換えることはしない (歴史記録の改竄になる)。Sweep 対象は CLAUDE.md / README.md / architecture.md / protocol.md の運用文書のみ。

---

## アーキテクチャ概要 (削除後の状態)

```
concert/                           # M4 で cyfyapp/song に改名予定
├── apps/
│   ├── claude-app-server/         # TS、変更なし
│   ├── conductor/                 # TS、M4 で perform に改名予定
│   │   └── test/                  # dashboard-parity.test.ts / fixtures/dashboard/ 削除済
│   └── e2e/                       # build + dev:install + test を自己完結
│       └── package.json           # test:setup を新設
├── docs/
│   ├── adr/
│   │   ├── 0008-...md             # status 更新
│   │   ├── 0014-...md             # 不変 (注記は ADR-0015 側)
│   │   └── 0015-conductor-port.md # 新規
│   ├── milestones/
│   │   └── 03-conductor-port.md   # 新規
│   ├── architecture.md            # symphony 言及 sweep
│   ├── protocol.md                # 同上
│   └── e2e_testing.md             # 同上 (Elixir / mix セットアップ削除)
├── flake.nix                      # Erlang/Elixir 削除
├── package.json                   # build:symphony / test:symphony 削除
├── pnpm-workspace.yaml            # 変更なし (apps/* glob のまま)
├── .gitignore                     # apps/e2e/symphony.log → apps/e2e/backend.log
├── CLAUDE.md                      # symphony 言及 sweep、ディレクトリ図更新
├── README.md                      # 同上
└── TODO.md                        # Phase 7 完了マーク、M4+ 候補に snapshot 再構築追加
```

---

## モジュール / ファイル変更一覧

### 削除 (ディレクトリ単位)

| パス | 種別 |
|---|---|
| `apps/symphony/` | **ディレクトリごと削除** |

### 削除 (個別ファイル)

| パス | 理由 |
|---|---|
| `apps/conductor/scripts/diff-symphony-dashboard.ts` | symphony 並走前提の dev-only 差分スクリプト |
| `apps/conductor/test/integration/dashboard-parity.test.ts` | symphony golden への byte 比較 test |
| `apps/conductor/test/fixtures/dashboard/empty.{txt,json}` | symphony golden + spec |
| `apps/conductor/test/fixtures/dashboard/multi-running.{txt,json}` | 同上 |
| `apps/conductor/test/fixtures/dashboard/narrow-terminal.{txt,json}` | 同上 |
| `apps/conductor/test/fixtures/dashboard/one-running-claude.{txt,json}` | 同上 |
| `apps/conductor/test/fixtures/dashboard/one-running-codex.{txt,json}` | 同上 |
| `apps/conductor/test/fixtures/dashboard/rate-limited.{txt,json}` | 同上 |
| `apps/conductor/test/fixtures/dashboard/retry-only.{txt,json}` | 同上 |
| `apps/conductor/test/fixtures/dashboard/snapshot-unavailable.{txt,json}` | 同上 |
| `apps/conductor/test/fixtures/dashboard/` (空ディレクトリ) | rmdir |

### 修正 (中身書き換え)

| パス | 変更 |
|---|---|
| `package.json` | `build` から `&& pnpm build:symphony` 除去 / `test` から `&& pnpm test:symphony` 除去 / `build:symphony` 削除 / `test:symphony` 削除 / `test:e2e` を `pnpm --filter e2e test:setup && pnpm --filter e2e test` に変更 / `test:e2e:setup` 削除 |
| `apps/e2e/package.json` | `test:setup` script 新設 (下記参照) |
| `apps/e2e/lib/common.ts` | symphony 分岐削除、`Symphony*` → `Backend*` rename、`CONCERT_E2E_BACKEND` / `VALID_BACKENDS` / `readBackendChoice` 削除、`resolveBackendCommand` を conductor 固定の純関数に縮退、`REQUIRED_TOOLS` から `'mix'` 除去 |
| `apps/e2e/claude-linear.ts` | `spawnSymphony` 等の呼び出しを `spawnBackend` 等に書き換え |
| `apps/e2e/claude-github.ts` | 同上 |
| `flake.nix` | `beamPkgs` / `elixir` / `beamPkgs.erlang` 除去、`description` の "Symphony" 文言更新 |
| `.gitignore` | `apps/e2e/symphony.log` → `apps/e2e/backend.log` |
| `CLAUDE.md` (root) | "## このリポジトリは何" の symphony 説明を「`apps/conductor` が orchestrator」に書き換え / "## ディレクトリ構成" の `apps/symphony/` ブロック削除 / "## 両アプリにまたがる仕様" を「`apps/claude-app-server` と `apps/conductor` の 2 者」に統一 / "## モノレポにした理由" の Elixir/TS 二重スタック前提を「TS スタックを 2 app で共有」に変更 / "## 落とし穴" の Elixir 関連 (HOME 切り替え、mix の存在) を sweep |
| `README.md` | 同方針で sweep。Symphony 由来であることは触れず、現状の monorepo として記述 |
| `docs/architecture.md` | symphony 図 / コンポーネント説明を conductor 中心に書き換え |
| `docs/protocol.md` | "Symphony が喋る" 表現を "conductor が喋る" に置換、SPEC 互換性の表は変更なし |
| `docs/e2e_testing.md` | "ツール" セクションから mise/Elixir/Erlang 削除 / "ビルド手順" から `build:symphony` 除去 / "E2E 実行" 内の `./bin/symphony` 手動コマンド削除、`conductor` 等価コマンドに置換 / Symphony ログ参照 (`apps/e2e/symphony.log`) を `apps/e2e/backend.log` に変更 |
| `apps/conductor/CLAUDE.md` | 「`apps/symphony` (Elixir) を TS で書き直した」を「概念的に symphony から派生したが、M3 で TS 化完了済の orchestrator」に変更 / Phase 7 完了状態 / "M3 完了後 (Phase 7) に `apps/symphony` を削除し" のセクションを「`apps/symphony` 削除済 (Phase 7、2026-05-18)」に更新 |
| `apps/claude-app-server/CLAUDE.md` | symphony 起動側との連携を述べた箇所を「conductor (および任意の Codex App Server 互換クライアント) が起動する」に書き換え |
| `apps/claude-app-server/README.md` | 同上 |
| `apps/conductor/README.md` | symphony 言及があれば conductor 単独の文脈に書き換え |
| `docs/adr/0008-symphony-to-conductor-migration.md` | ステータス行を `Accepted` → `Accepted (implemented 2026-05-18 in M3 Phase 7, see [ADR-0015](0015-conductor-port-completion.md))` に変更 (本文は触らない) |
| `docs/adr/README.md` | ADR-0015 を一覧に追加 |
| `TODO.md` | Phase 7 のチェックボックスを全部 `[x]` 化、Milestone 3 完了マーク / M4+ 候補に「conductor 自身の TUI snapshot 回帰検出 (vitest auto-snapshot で再構築)」項目追加 / `CONCERT_E2E_BACKEND` 言及があれば削除 |

### 新規作成

| パス | 内容 |
|---|---|
| `docs/adr/0015-conductor-port-completion.md` | 下記スケルトン参照 |
| `docs/milestones/03-conductor-port.md` | 下記スケルトン参照 |

---

## 新規ドキュメント スケルトン

### ADR-0015 (`docs/adr/0015-conductor-port-completion.md`)

```markdown
# 15. `apps/conductor` 化完了に伴う `apps/symphony` 廃止

## ステータス

Accepted

決定日: 2026-05-18

## コンテキスト

[ADR-0008](0008-symphony-to-conductor-migration.md) で「`apps/conductor` 完成後に `apps/symphony` を削除する」と決定した。Milestone 3 Phase 1〜6 で TS 移植が完了し、Linear / GitHub E2E と並列スケジューラ / retry / 異常系 / file logger まで symphony parity を取った状態に到達した。

ADR-0008 は削除タイミングを明示せず Phase 7 に委ねていた。当初 TODO.md は「conductor 単独運用を 1 週間以上回した後」を予約していたが、Milestone 4 でリブランディング (`conductor → perform`) と state 別 backend 切替が入る前提のため、symphony を fallback として残す価値は実質的に消滅している。

## 決定

Phase 7 で以下を一括実施する:

- `apps/symphony/` ディレクトリの削除
- ルート `package.json` の Elixir 系 script (`build:symphony` / `test:symphony`) 削除
- `apps/e2e/lib/common.ts` の symphony 分岐削除、関数・型を backend-neutral に rename
- `test:e2e:setup` の cross-workspace 部分を `apps/e2e/package.json` に畳む
- `flake.nix` から Erlang/Elixir 削除
- `apps/conductor/test/fixtures/dashboard/` (symphony 並走期間の TUI golden) と `dashboard-parity.test.ts` の削除
- ルート CLAUDE.md / README.md / docs/architecture.md / docs/protocol.md / docs/e2e_testing.md の symphony 参照 sweep

[ADR-0014](0014-symphony-owned-state-transitions.md) の本文は変更しない (歴史的記録)。架構決定 (orchestrator が `doing_state` / `done_state` を直接 mutation する) は依然有効であり、本 ADR で「ADR-0014 の orchestrator owner は M3 Phase 7 以降 conductor を指す」と明記する。

## 結果

- **良い影響**:
  - モノレポが TypeScript 単一スタックになり、CI・開発環境・新規参加者の学習コストが下がる
  - DevContainer の初回ビルドで Erlang/Elixir のダウンロードが走らなくなり、起動が高速化する
  - Milestone 4 のリブランディング (`conductor → perform`) を 2 app だけで行えば済む
- **悪い影響 / トレードオフ**:
  - Elixir/OTP の障害耐性設計は完全に手放す。conductor 側で TS の plain async + AbortController + p-queue + p-retry で代替済 (Phase 6)
  - symphony と conductor の挙動 byte-for-byte 比較ができなくなる (`dashboard-parity.test.ts` を削除)。conductor の TUI 回帰検出は Milestone 4+ で vitest auto-snapshot として書き直すかを別途判断する
  - 過去 commit を辿って Elixir 実装を参照する必要があれば `git show <commit>:apps/symphony/...` を使う
- **影響範囲**: モノレポ言語構成 / CI / DevContainer / E2E 起動 script / `apps/conductor/CLAUDE.md` の Phase 7 ステータス / Milestone 3 完了
```

### Milestone 03 (`docs/milestones/03-conductor-port.md`)

```markdown
# Milestone 3: `apps/conductor` (TypeScript) 化

**ステータス:** 完了 (2026-05-18)

`apps/symphony` (Elixir) を `apps/conductor` (TypeScript) に書き直し、モノレポを単一スタックに統一する Milestone。Phase 1〜6 で機能 parity を達成し、Phase 7 で `apps/symphony` 削除とドキュメント sweep を完了して clos した。

> このファイルは完了済みマイルストーンの記録。進行中・将来のタスクは [`TODO.md`](../../TODO.md) 参照。

---

## 横断する設計指針 (Milestone 3 時点での凍結事項)

- 現 symphony の 1:1 移植 (新規機能は Milestone 4+ 送り)
- TS スタックは `apps/claude-app-server` と統一 (valibot / byethrow / commander / vitest / oxlint / oxfmt)
- in-source test (`import.meta.vitest`) + `test/` integration / e2e
- YAML は js-yaml、TUI は vanilla ANSI (Ink 非採用)、prompt templating は liquidjs
- kamae 準拠 (discriminated unions / branded types / Result / valibot boundary / PII 保護 / 1 file 1 module)
- 並行モデルは plain async + AbortController + p-queue + p-retry (XState / Effect 不採用)
- 状態遷移は orchestrator 主導 ([ADR-0014](../adr/0014-symphony-owned-state-transitions.md) の owner を conductor 側に継承)

---

## Phase 1: TS bootstrap + Memory tracker で in-process happy path

**完了 (2026-05-16).** spec: [`2026-05-16-m3-phase1-design.md`](../superpowers/specs/2026-05-16-m3-phase1-design.md)

- (Phase 1 のチェックリストを TODO.md L30-39 から転記)

---

## Phase 2: 実 backend subprocess 管理 + Workspace 管理

**完了 (2026-05-16).** spec: [`2026-05-16-m3-phase2-design.md`](../superpowers/specs/2026-05-16-m3-phase2-design.md)

- (TODO.md L41-52 から転記)

---

## Phase 3: Linear tracker + 自動 state 遷移 + Linear E2E

**完了 (2026-05-16).** spec: [`2026-05-16-m3-phase3-design.md`](../superpowers/specs/2026-05-16-m3-phase3-design.md)

- (TODO.md L54-60 から転記)

---

## Phase 4: GitHub tracker + GitHub E2E

**完了 (2026-05-17).** spec: [`2026-05-17-m3-phase4-design.md`](../superpowers/specs/2026-05-17-m3-phase4-design.md)

- (TODO.md L62-69 から転記)

---

## Phase 5: TUI dashboard + observability

**完了 (2026-05-17).** spec: [`2026-05-17-m3-phase5-design.md`](../superpowers/specs/2026-05-17-m3-phase5-design.md)

- (TODO.md L71-78 から転記)

---

## Phase 6: 並列実行・リトライ・edge cases パリティ

**完了 (2026-05-17).** spec: [`2026-05-17-m3-phase6-design.md`](../superpowers/specs/2026-05-17-m3-phase6-design.md)

- (TODO.md L80-87 から転記)

---

## Phase 7: `apps/symphony` 削除 + ドキュメント sweep

**完了 (2026-05-18).** spec: [`2026-05-18-m3-phase7-design.md`](../superpowers/specs/2026-05-18-m3-phase7-design.md), ADR: [`0015-conductor-port-completion.md`](../adr/0015-conductor-port-completion.md)

- [x] `apps/symphony/` 削除
- [x] ルート CLAUDE.md / docs/architecture.md / docs/protocol.md / README.md の symphony 参照 sweep
- [x] flake.nix / pnpm script から symphony 参照を削除
- [x] `test:e2e:setup` の cross-workspace 部分を `apps/e2e/package.json` に畳む
- [x] `apps/conductor/test/fixtures/dashboard/` と `dashboard-parity.test.ts`、`diff-symphony-dashboard.ts` を削除
- [x] ADR-0008 status 更新 + ADR-0015 起票
- [x] このマイルストーン記録の作成

---

## Milestone 3 完了条件

- [x] Phase 1〜7 完了
- [x] `pnpm --filter conductor test` 全緑
- [x] `pnpm test:e2e:claude-linear` / `:claude-github` 緑
- [x] `apps/symphony` が repo から消えている (`git grep -i symphony` のヒットが歴史ドキュメントのみ)
- [x] ADR-0008 implemented、ADR-0015 起票

---

## Milestone 4 以降に送った課題

- リブランディング (`cyfyapp/song` umbrella + `conductor → perform`)
- state 別 backend 切替 + passthrough 機構
- Web ダッシュボード
- conductor 自身の TUI snapshot 回帰検出 (vitest auto-snapshot)
- その他は [`TODO.md`](../../TODO.md) を参照
```

### `apps/e2e/package.json` の `test:setup` script (確定形)

```json
{
  "scripts": {
    "build": "tsdown",
    "test:setup": "pnpm --filter claude-app-server build && pnpm --filter conductor build && pnpm --dir ../claude-app-server link --global && pnpm --dir ../conductor link --global && pnpm build",
    "test": "pnpm test:claude-linear && pnpm test:claude-github",
    "test:claude-linear": "node dist/claude-linear.mjs",
    "test:claude-github": "node dist/claude-github.mjs"
  }
}
```

ルート `package.json` 側:

```json
{
  "scripts": {
    "build": "pnpm build:claude-app-server && pnpm build:conductor",
    "build:claude-app-server": "pnpm --filter claude-app-server build",
    "build:conductor": "pnpm --filter conductor build",
    "test": "pnpm test:claude-app-server && pnpm test:conductor",
    "test:claude-app-server": "pnpm --filter claude-app-server test",
    "test:conductor": "pnpm --filter conductor test",
    "test:e2e": "pnpm --filter e2e test:setup && pnpm --filter e2e test",
    "test:e2e:claude-linear": "pnpm --filter e2e test:claude-linear",
    "test:e2e:claude-github": "pnpm --filter e2e test:claude-github",
    "dev:install": "pnpm --dir apps/claude-app-server link --global && pnpm --dir apps/conductor link --global",
    "dev:uninstall": "pnpm uninstall -g claude-app-server || true; pnpm uninstall -g conductor || true"
  }
}
```

- `dev:install` を `cd && pnpm link` から `pnpm --dir <path> link` に変更 (cd の副作用回避、pnpm のドキュメント奨励形式)
- `test:e2e:setup` は削除 (`apps/e2e/test:setup` が代替)
- `build:symphony` / `test:symphony` は削除

---

## テスト戦略

Phase 7 は削除ベースのリファクタなので **新規テストは書かない**。既存テストが全部緑のままであることだけ確認する。

### 検証順序

1. **`pnpm --filter conductor test`** — dashboard-parity.test.ts と fixtures 削除後、`pnpm --filter conductor test` 全緑
2. **`pnpm --filter claude-app-server test`** — 変更が無いことの確認
3. **`pnpm test`** — root aggregator が `test:symphony` を呼ばずに完走
4. **`pnpm build`** — root aggregator が `build:symphony` を呼ばずに 2 app をビルド
5. **`pnpm test:e2e`** — `apps/e2e/test:setup` 経由で `pnpm link --global` が効き、両 tracker の E2E が緑
6. **`pnpm dev:uninstall && pnpm dev:install`** — link/unlink 経路の手動 smoke test
7. **`direnv reload`** (DevContainer 内) — Erlang/Elixir を pull せずに devShell が立ち上がる
8. **`git grep -in "symphony" -- ':!docs/milestones/' ':!docs/superpowers/specs/' ':!docs/adr/' ':!docs/milestones/03-conductor-port.md'`** — ヒットが 0 行
9. **`git grep -i "elixir\|erlang\|\\bmix\\b"`** — Elixir/Erlang/mix のヒットが歴史ドキュメントのみ (新規 README / CLAUDE.md / e2e_testing.md にない)

### 落とし穴

- `pnpm link --global` は workspace を絡めると pnpm 9 系で挙動が変わることがある。`apps/e2e/test:setup` から呼ぶ場合、`pnpm --dir <path> link --global` 形式で確実に dir を切り替える
- `pnpm --filter e2e test:setup` は workspace filter なので cwd は `apps/e2e` になる。それを前提に `pnpm --dir ../claude-app-server link --global` で相対パス指定する。E2E build (`tsdown`) は最後に `pnpm build` (= filter 既に e2e なので current dir に閉じる) で実行
- `flake.nix` を編集すると `direnv reload` で再評価される。Nix store に既存の elixir があると古い devShell に固定される可能性 — `nix flake update` または `direnv reload` 後の Erlang/Elixir 不在を確認する
- `apps/conductor/dist/observability/dashboard.js{,.map,.d.ts}` は build 成果物。Phase 7 では削除しない (build で再生成される)

---

## 実装順 (依存関係順)

1. **fixtures / parity test 削除** (`apps/conductor/test/fixtures/dashboard/`、`dashboard-parity.test.ts`、`diff-symphony-dashboard.ts`)
2. **`pnpm --filter conductor test` で緑確認**
3. **`apps/e2e/lib/common.ts` の symphony 分岐削除 + `Symphony*` → `Backend*` rename**
4. **`apps/e2e/claude-linear.ts` / `claude-github.ts` 追従**
5. **`apps/e2e/package.json` に `test:setup` 新設**
6. **ルート `package.json` から `build:symphony` / `test:symphony` / `test:e2e:setup` 削除、`dev:install` を `pnpm --dir` 形式に**
7. **`.gitignore` の `apps/e2e/symphony.log` 修正**
8. **`apps/symphony/` ディレクトリ削除**
9. **`flake.nix` から Erlang/Elixir 削除、`direnv reload` で確認**
10. **`pnpm build` / `pnpm test` / `pnpm test:e2e` の全部緑確認** (この時点で機能変更は完了)
11. **CLAUDE.md (root) / README.md / docs/architecture.md / docs/protocol.md / docs/e2e_testing.md sweep**
12. **`apps/conductor/CLAUDE.md` / `apps/claude-app-server/CLAUDE.md` / 両 README.md sweep**
13. **ADR-0008 status 更新 + ADR-0015 新規執筆 + `docs/adr/README.md` 更新**
14. **`docs/milestones/03-conductor-port.md` 新規執筆 + `docs/milestones/README.md` の表に追加**
15. **TODO.md の Phase 7 / Milestone 3 完了マーク + M4+ 候補に snapshot 再構築追加**
16. **`git grep -i symphony` の最終確認**

各ステップで小さく commit する。1〜2 が「テスト基盤の歴史削除」、3〜7 が「E2E 整理」、8〜9 が「symphony 削除と build/test 確認」、11〜15 が「ドキュメント sweep + 公式記録」。

---

## 不確実性 / 実装中に確認しうる事項

- **`pnpm --dir <path> link --global` の挙動**: pnpm 9.x で動作することを実装前に手元で確認 (`pnpm --dir apps/conductor link --global` でグローバルに `conductor` コマンドが出るか)
- **`flake.nix` 更新後の Nix キャッシュ挙動**: Erlang/Elixir を除いた flake で初回 build 時にビルド時間が伸びる可能性。Cachix を設定していなければ初回のみ若干遅くなる
- **`apps/e2e/lib/common.ts` の `Symphony*` rename**: error message 文字列も `symphony` → `backend` に変更するが、E2E スクリプト消費側 (人間が読むログ) で「あれ?」と思う可能性。後方互換は気にしない (個人ユース) ので一括変更で OK
- **`docs/e2e_testing.md` の Symphony observed events 抜粋**: M2 Phase 4 E2E 実行ログとして commit 済みの記述あり (`apps/symphony/log/symphony.log.1` 引用)。**これは履歴の引用なので残す** (Phase 7 sweep の対象外)
- **`apps/symphony/mise.toml`** の削除に伴って root に mise を新規導入する必要は無い (Node/pnpm は flake.nix で十分)
- **`workflow.claude-linear.md` / `workflow.claude-github.md`** (apps/e2e 配下) は backend 中立な文書なので変更不要
- **`apps/symphony/log/`** など `.gitignore` 経由で無視されているディレクトリの残骸が手元にあれば、`git clean` 推奨 (ただし手元状態なので spec の責務外)

---

## 参考資料

- [TODO.md](../../../TODO.md) Milestone 3 / Phase 7
- [M3 overview](2026-05-15-m3-overview-design.md)
- [M3 Phase 6 spec](2026-05-17-m3-phase6-design.md)
- ADR-0008 (Symphony to conductor migration)
- ADR-0014 (Symphony-owned state transitions、conductor 側で継承)
- 削除対象: `apps/symphony/` 全体、`apps/conductor/test/fixtures/dashboard/`、`apps/conductor/test/integration/dashboard-parity.test.ts`、`apps/conductor/scripts/diff-symphony-dashboard.ts`
