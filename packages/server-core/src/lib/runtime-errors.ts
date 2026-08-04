export type LocalAppRuntimeErrorCode =
  | "action_timeout"
  | "action_resource_limit"
  | "action_runtime_error"
  | "action_concurrency_timeout"
  | "db_runtime_error"
  | "db_contract_error"
  | "db_queue_timeout"
  | "named_sql_result_too_large";

export interface LocalAppRuntimeErrorDetails {
  [key: string]: unknown;
}

export class LocalAppRuntimeError extends Error {
  status: number;
  code: LocalAppRuntimeErrorCode;
  details?: LocalAppRuntimeErrorDetails;
  override cause?: unknown;

  constructor(
    message: string,
    options: {
      status?: number;
      code: LocalAppRuntimeErrorCode;
      details?: LocalAppRuntimeErrorDetails;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "LocalAppRuntimeError";
    this.status = options.status ?? 500;
    this.code = options.code;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export function isWasmRuntimeError(err: unknown): boolean {
  if (typeof WebAssembly !== "undefined" && err instanceof WebAssembly.RuntimeError) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/memory access out of bounds|wasm|webassembly/i.test(message)) return true;
  const stack = err instanceof Error ? err.stack ?? "" : "";
  return /sql-wasm\.js/i.test(stack) && (message.trim() === "" || message.includes("\uFFFD"));
}

export function summarizeError(err: unknown): LocalAppRuntimeErrorDetails {
  if (err instanceof Error) {
    return {
      originalName: err.name,
      originalMessage: err.message,
    };
  }
  return {
    originalMessage: String(err ?? "Unknown error"),
  };
}

export function wrapDatabaseRuntimeError(
  err: unknown,
  context: {
    operation: "query" | "mutation" | "transaction" | "raw";
    sqlName?: string;
    dbPath?: string;
  },
): LocalAppRuntimeError {
  return new LocalAppRuntimeError("Database runtime error while executing hosted data operation", {
    status: 500,
    code: "db_runtime_error",
    cause: err,
    details: {
      operation: context.operation,
      sqlName: context.sqlName,
      ...summarizeError(err),
    },
  });
}

export function wrapDatabaseContractError(
  err: unknown,
  context: {
    operation: "query" | "mutation";
    sqlName: string;
  },
): LocalAppRuntimeError {
  return new LocalAppRuntimeError("Database contract error while executing named SQL", {
    status: 400,
    code: "db_contract_error",
    cause: err,
    details: {
      operation: context.operation,
      sqlName: context.sqlName,
      ...summarizeError(err),
    },
  });
}
