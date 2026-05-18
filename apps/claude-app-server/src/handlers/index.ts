import type { Dispatcher } from "../jsonrpc/dispatcher.js";
import { initializeHandler, initializedHandler } from "./initialize.js";
import { registerStubs } from "./stub.js";
import { registerThreadHandlers } from "./thread.js";
import { registerTurnHandlers } from "./turn.js";

export const registerHandlers = (dispatcher: Dispatcher): void => {
  dispatcher.registerRequest("initialize", initializeHandler);
  dispatcher.registerNotification("initialized", initializedHandler);
  registerThreadHandlers(dispatcher);
  registerTurnHandlers(dispatcher);
  registerStubs(dispatcher);
};
