# 16. PII を `Sensitive<T>` wrapper で型レベル保護する

## ステータス

Accepted

決定日: 2026-05-17

## コンテキスト

[ADR-0011](0011-kamae-for-typescript.md) で kamae 原則の採用を決定し、その一節として「PII（認証トークン・ユーザコンテンツ等）はログ・エラーメッセージに混入させない」を明記した。

Milestone 3 (Conductor port) 進行時点での実装は、この方針を `apps/conductor/src/util/redact.ts` の **手動 redact 関数** で実現していた:

```typescript
export const redactConfig = (cfg: WorkflowConfig): WorkflowConfig => {
  const tracker = cfg.tracker;
  switch (tracker.kind) {
    case "linear":  return { ...cfg, tracker: { ...tracker, apiKey: "*****" } };
    case "github":  return { ...cfg, tracker: { ...tracker, apiKey: MASK } };
    case "memory":  return cfg;
  }
};
```

呼び出し側 (`cli/run.ts`) で `JSON.stringify(redactConfig(config))` を毎回行う方式。次の問題があった:

- **呼び出し漏れリスク**: 新しいログ出力箇所で `redactConfig` を通し忘れると平文の API key がログに混入する
- **型レベルでは plain `string`**: 関数シグネチャから「これは秘匿」が読み取れない
- **新規 PII を追加するたびに `redactConfig` の switch を拡張する必要**: 将来 OAuth token・Slack webhook 等を扱うと switch が肥大化
- **JSON.stringify 経由以外の経路でリーク余地**: `console.log(config)` を直接書くと redact なしで出力される

2026-05-17 の `apps/conductor` 全体 kamae-review でこの設計は「Suggestion (S1)」として `Sensitive<T>` wrapper への置換を勧告された。

## 決定

`apps/conductor` の boundary で扱う PII (現時点では `linear.api_key` / `github.api_key`) を `Sensitive<T>` wrapper でラップする。

### 実装

`apps/conductor/src/util/sensitive.ts`:

```typescript
export type Sensitive<T> = Readonly<{
  readonly __sensitive: true;
  reveal: () => T;
  toString: () => string;
  toJSON: () => string;
}>;

export const Sensitive = {
  of: <T>(value: T): Sensitive<T> => ({
    __sensitive: true,
    reveal: () => value,
    toString: () => "*****",
    toJSON: () => "*****",
  }),
} as const;
```

- raw 値は closure 内に隔離。アクセスは `.reveal()` のみ
- `toString` / `toJSON` は `"*****"` を返す → `JSON.stringify` / template literal / `String(...)` で自動マスク
- 型 `Sensitive<string>` ≠ `string` → 関数シグネチャから「秘匿」が読み取れる

### 適用ポリシー

1. **wrap は schema boundary で**: `config/schema.ts buildTracker` で `apiKey: Sensitive.of(apiKeyR.value)` として組み立て、以降の pipeline は全て `Sensitive<string>` を扱う
2. **`.reveal()` は最終 boundary でのみ**: HTTP `Authorization` header の組み立て (`tracker/linear/client.ts` / `tracker/github/client.ts`) でのみ呼ぶ。adapter / factory / orchestrator では reveal しない
3. **手動 redact 関数 (`util/redact.ts`) は削除**: `JSON.stringify(config)` がそのまま安全になる

将来 PII を追加する場合 (例: GitHub PAT 以外の OAuth token、ユーザ電話番号、医療情報) は、domain 型の段階で `Sensitive<T>` 化することで自動的に保護対象になる。

### 既知の defense-in-depth ギャップ (accepted)

`Sensitive<T>` は `toString` / `toJSON` を上書きするが、`Symbol.for("nodejs.util.inspect.custom")` は **未実装**。`console.log(config)` や `util.inspect(config)` (pino 等の logger が内部で使う) を直接呼ぶと、object の enumerable property (`__sensitive: true`, `reveal: [Function]`) が出力される。raw 値そのものは closure 内なので漏れないが、構造が見えてしまう点で完全な対策ではない。

現時点では `apps/conductor` は `process.stdout.write` / `process.stderr.write` ベースの自前 logger (`util/logger.ts`) しか使っておらず、文字列フォーマットも `JSON.stringify` 経由なので問題なし。将来 pino 等を導入する際に inspect.custom 対応を追加する。

## 結果

- **良い影響**:
  - 型レベルで「秘匿」が明示される (`apiKey: Sensitive<string>` ≠ `apiKey: string`)
  - 新規ログ出力箇所で redact 呼び出しを忘れても自動マスク
  - PII の種類を追加しても `redactConfig` のような switch を拡張する必要なし
  - kamae 原則 (boundary-defense.md §PII Protection) と完全に整合
  - `Sensitive.of` を `valibot` の `v.transform` と組み合わせれば schema 段階で自動 wrap も可能 (将来案)
- **悪い影響 / トレードオフ**:
  - HTTP header の組み立てで `.reveal()` の明示的呼び出しが必要 (一箇所限定なので許容範囲)
  - `Sensitive<T>` を返す helper や `Sensitive.of(...)` を test fixture で書く必要が出る (kamae 原則上はむしろ望ましい摩擦)
  - `Symbol.for("nodejs.util.inspect.custom")` 未対応 (上記、acceptedな defense-in-depth ギャップ)
- **影響範囲**:
  - `apps/conductor/src/util/sensitive.ts` (新規)
  - `apps/conductor/src/util/redact.ts` (削除)
  - `apps/conductor/src/domain/tracker-config.ts` (`apiKey: Sensitive<string>`)
  - `apps/conductor/src/config/schema.ts` (`buildTracker` で `Sensitive.of` wrap)
  - `apps/conductor/src/tracker/linear/client.ts` / `github/client.ts` (`.reveal()` で Authorization header)
  - `apps/conductor/src/cli/run.ts` (`redactConfig` 削除、`JSON.stringify(config)` 直接)
  - `apps/conductor/CLAUDE.md` (設計指針セクションに反映済)
  - 将来 `apps/claude-app-server` で PII を扱う場合の参照点
