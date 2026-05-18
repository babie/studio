# ADR-0017: Rebrand `babie/concert` → `babie/studio`, `apps/conductor` → `apps/perform`

**Status:** Accepted (2026-05-18)

## Context

M3 完了で `apps/symphony` (Elixir) を削除し、`apps/conductor` (TypeScript) に統一した ([ADR-0015](0015-conductor-port-completion.md))。M4 以降は umbrella CLI (`apps/{compose,perform,mix}`) や state 別 backend 切替などの機能拡張に入るため、リブランディングを最初に一括で済ませる必要がある。

加えて、これまでの開発で第三者著作物 (`docs/vendor/*`) が public 履歴に残ったままだが、`babie/concert` が fork repo であるため GitHub の制限で private 化できない。リブランディングをフレッシュリポジトリへの移行として実施することで、公開履歴から第三者著作物を確実に排除できる。

## Decision

1. **Repository**: `babie/concert` (public, fork) を破棄し、`babie/studio` (public, 通常 repo, Apache-2.0) を新規作成する。旧 repo は `babie/concert-archive` (private 通常 repo) に mirror push したうえで削除する。
2. **Sub-app**: `apps/conductor` を `apps/perform` にリネーム。binary 名も `conductor` → `perform`。
3. **NPM scope**: `@babie/*` を据置 (将来 `@cyfyapp/*` への変更が必要になったタイミングで再判断)。
4. **Umbrella name**: `studio` (= `apps/{compose,perform,mix}` を抱える制作スタジオのメタファー)。
5. **Excluded from new repo**: `docs/vendor/`, `SPEC.md`, `/workspace/memory/`, `.github/media/symphony-demo.*`。
6. **License**: Apache-2.0 継承 (本家 openai/symphony と同じ)。
7. **README 謝辞**: openai/symphony 出自を明示する文言は残す。

## Alternatives Considered

- **`cyfyapp/studio` (org 移行)**: 将来の `cyfyapp/score` SaaS とブランド統一できるが、個人 fork の出自が見えにくくなる。`@cyfyapp/*` npm scope reserve も必要。M4 段階では先送り。
- **`git filter-repo` で履歴を書き換え**: `docs/vendor/*` を全 commit から除去して in-place rename。漏れ検知が困難、commit hash 参照も結局壊れる。フレッシュ移行のほうがクリーン。
- **GitHub Support に fork 解除依頼**: `babie/concert` を private 化するために fork relationship を detach。サポート待ちが発生、また旧 repo に履歴が残るので docs/vendor 問題は解決しない。
- **Umbrella 名 `song` / `band` / `opus`**: 候補として検討。`song` は generic すぎて商標化困難、`band` は冗長 (`band perform`)、`opus` は Claude モデル名と紛らわしい。`studio` を採用。

## Consequences

- 旧 commit hash 参照は dead に。過去 ADR / spec 内の `concert` / `conductor` 表記は履歴として残し、本 ADR で「以後 `studio` / `perform` を使う」と宣言する。
- `babie/concert-archive` (private) が履歴参照用として残り、外部からは見えない。
- 旧 OrbStack ボリューム (`babie-concert_{home,nix}`) はリネーム不可、新ボリュームに tar 移行する。
- macOS native Claude Code のプロジェクトディレクトリ (`-Users-…-concert`) は手動 rename + 再認識が必要。
- `bin: conductor` から `bin: perform` への変更により、ユーザー (開発者本人) のシェル alias / スクリプトは更新が必要。

## Related

- [ADR-0008](0008-symphony-to-conductor-migration.md) — Symphony (Elixir) → Conductor (TS) 移行決定
- [ADR-0015](0015-conductor-port-completion.md) — Conductor port 完了
- [`docs/superpowers/specs/2026-05-18-m4-rebranding-design.md`](../superpowers/specs/2026-05-18-m4-rebranding-design.md) — 本リブランディングの設計書
- [`docs/milestones/04-rebranding.md`](../milestones/04-rebranding.md) — M4 完了記録 (M4 完了時に finalize)
