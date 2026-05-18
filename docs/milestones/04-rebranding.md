# Milestone 4: リブランディング (`babie/concert` → `babie/studio`)

**ステータス:** 完了 (2026-05-18)

詳細・チェックリスト: [`docs/superpowers/specs/2026-05-18-m4-rebranding-design.md`](../superpowers/specs/2026-05-18-m4-rebranding-design.md)

実装プラン: [`docs/superpowers/plans/2026-05-18-m4-rebranding.md`](../superpowers/plans/2026-05-18-m4-rebranding.md)

ADR: [`0017-rebranding-to-studio.md`](../adr/0017-rebranding-to-studio.md)

---

## 完了サマリ

- 完了日: 2026-05-18
- Phase 4a 完了状態: `babie/studio` 初期コミット `bc0759a` (init: babie/studio monorepo) に集約。Phase 4a の `feat/m4-rebranding` ブランチはローカル限定で旧 `babie/concert` には push せず、rsync 経由で新リポジトリにフレッシュコミットされた
- Phase 4b 完了タイミング: 2026-05-18 (ユーザーが mirror push → babie/studio 作成 → macOS rename → OrbStack volume tar 移行 → 新 DevContainer 起動を順次実施)
- Phase 4c E2E 緑確認: 2026-05-18 (`pnpm test:e2e:claude-linear` / `pnpm test:e2e:claude-github` 双方 PASS、commit `61ed15e` 時点)
- 旧 OrbStack ボリューム削除: ユーザー判断のソーク期間後 (Task 27 ユーザーアクション)
- `babie/concert` GitHub 削除: ユーザー判断のソーク期間後 (Task 27 ユーザーアクション)
- `babie/concert-archive` (private mirror): 履歴参照用に残置

## 引っかかった点

- **新 DevContainer に SSH key が無く `git push` が失敗**: `~/.ssh/` が新 home volume に存在せず `git@github.com:babie/studio.git` への push が host key verification で落ちた。`gh auth setup-git` で gh CLI を git credential helper に設定し、origin URL を HTTPS (`https://github.com/babie/studio.git`) に切り替えて解決
- **GitHub Project 番号変更**: 旧 `babie/concert` の Project は `users/babie/projects/3` だったが、新 `babie/studio` のために作成した Project は `users/babie/projects/4`。`apps/e2e/workflow.claude-github.md` の `project_number` を 3 → 4 に更新 (commit `d3b27ee`)
- **GitHub test issue body 不足**: 新規作成した `babie/studio#1` の body が "Test issue for pnpm test:e2e:claude-github" のみで、E2E 検証が期待する `tmp/hello.js` 作成指示を含んでいなかった。Linear `CYFY-5` の body を参考に書き直し
- **ファイルパス自己参照ヘッダー 22 件の見落とし**: `apps/perform/src/**/*.ts` の先頭行 `// apps/conductor/...` がフレッシュコピー後も残っていた (Phase 4a の Task 5 では bin.ts / cli/run.ts 等の代表的な箇所のみ修正)。Task 24 grep audit で発見し sed で一括更新 (commit `61ed15e`)
- **Linear `CYFY-5` の state が Done**: E2E `test:setup` が `resetIssueToTodo` で `resetStateName: "Todo"` に戻すため、結果的に問題なく動作
- **`docs/vendor/` working tree 残存**: 新 DevContainer の `/workspace` に旧コピーが残っていたが `.gitignore` で除外済み、git history には一度も入っていないことを確認

## 振り返り

- フレッシュリポジトリ移行は `git filter-repo` よりも遥かに簡潔で、`docs/vendor/*` を確実に public 履歴から除外できた
- Phase 4a を `feat/m4-rebranding` ブランチで実施しつつ push せず rsync 一括移行する方針は、旧リポジトリの履歴に rebranding 痕跡を残さず、新リポジトリを単一の `init` commit で開始できる利点があった
- 「historical narrative」と「path self-reference」を区別して sweep するルール (plan Task 5 Step 5) が役に立った。M3 → M4 をまたぐ migration 記述 (例: "Algorithm originally ported from apps/symphony/...") はそのまま残し、現在地を示すヘッダー行のみ更新した
