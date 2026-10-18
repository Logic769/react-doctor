export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const KEYED_RECORD_RESET_UNSUPPORTED_GLOBAL_NAMES = new Set([
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "Object",
  "require",
  "module",
  "process",
  "globalThis",
  "window",
]);

export const KEYED_RECORD_RESET_UNSUPPORTED_MODULE_NAMES = new Set([
  "module",
  "node:module",
  "process",
  "node:process",
  "vm",
  "node:vm",
  "repl",
  "node:repl",
  "inspector",
  "node:inspector",
  "inspector/promises",
  "node:inspector/promises",
]);
