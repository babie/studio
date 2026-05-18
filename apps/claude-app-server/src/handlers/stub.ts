import type { Dispatcher } from "../jsonrpc/dispatcher.js";

/**
 * 任意のメソッドに静的レスポンスのスタブを登録する。
 * 擬似応答を増やしたい場合は registerStubs 内に行を足す。
 */
export const registerStub = (dispatcher: Dispatcher, method: string, response: unknown): void => {
  dispatcher.registerRequest(method, async () => response);
};

/**
 * Phase 4 時点のスタブ群を集約する。
 *
 * - `mcpServerStatus/list` → 空 servers リスト
 * - その他の未実装メソッド (`account/*`, `fs/*`, `thread/fork`, `thread/list`,
 *   `turn/steer`, `command/exec`, `thread/resume` 等) は dispatcher のデフォルト
 *   `-32601 Method not found` に任せる。擬似応答が必要になったらここに
 *   `registerStub(...)` を足す。
 */
export const registerStubs = (dispatcher: Dispatcher): void => {
  registerStub(dispatcher, "mcpServerStatus/list", { servers: [] });
};
