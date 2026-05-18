import os from "node:os";
import type { NotificationHandler, RequestHandler } from "../jsonrpc/dispatcher.js";

const SERVER_VERSION = "0.1.0";

export const initializeHandler: RequestHandler = async () => ({
  userAgent: `claude-app-server/${SERVER_VERSION}`,
  platformFamily: process.platform,
  platformOs: `${os.type()} ${os.release()}`,
});

export const initializedHandler: NotificationHandler = async () => {
  // Phase 1: 受信確認のみ。Phase 2 で「初期化完了」フラグの管理を追加予定。
};
