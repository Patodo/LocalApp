import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { format } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const MAGIC = Buffer.from("LADP");
const HEADER_BYTES = 8;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_FAILURE_MESSAGE_BYTES = 64 * 1024;

class ProtocolError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function encodeFrame(message) {
  let json;
  try {
    json = JSON.stringify(message);
  } catch {
    throw new ProtocolError("protocol_malformed_frame");
  }
  if (json === undefined) {
    throw new ProtocolError("protocol_malformed_frame");
  }

  const payload = Buffer.from(json, "utf8");
  if (payload.length > MAX_FRAME_BYTES) {
    throw new ProtocolError("protocol_frame_too_large");
  }
  const frame = Buffer.allocUnsafe(HEADER_BYTES + payload.length);
  MAGIC.copy(frame, 0);
  frame.writeUInt32BE(payload.length, 4);
  payload.copy(frame, HEADER_BYTES);
  return frame;
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages = [];

    while (true) {
      if (this.#buffer.length < MAGIC.length) return messages;
      if (!this.#buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
        this.#fail("protocol_malformed_frame");
      }
      if (this.#buffer.length < HEADER_BYTES) return messages;

      const payloadLength = this.#buffer.readUInt32BE(4);
      if (payloadLength > MAX_FRAME_BYTES) {
        this.#fail("protocol_frame_too_large");
      }
      if (this.#buffer.length < HEADER_BYTES + payloadLength) return messages;

      const payload = this.#buffer.subarray(HEADER_BYTES, HEADER_BYTES + payloadLength);
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
        messages.push(JSON.parse(text));
      } catch {
        this.#fail("protocol_malformed_frame");
      }
      this.#buffer = this.#buffer.subarray(HEADER_BYTES + payloadLength);
    }
  }

  #fail(code) {
    this.#buffer = Buffer.alloc(0);
    throw new ProtocolError(code);
  }
}

const credentialKeys = new Set([
  "xapikey",
  "authorization",
  "accesstoken",
  "refreshtoken",
]);

function isCredentialKey(key) {
  const normalized = key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return normalized.endsWith("apikey") || credentialKeys.has(normalized);
}

function sanitizedContext(value) {
  if (Array.isArray(value)) return value.map(sanitizedContext);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isCredentialKey(key))
      .map(([key, nested]) => [key, sanitizedContext(nested)]),
  );
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function serializableResult(value) {
  try {
    validateOriginalResult(value, new Set());
  } catch {
    throw new ProtocolError("result_serialization_failed");
  }

  let serialized;
  try {
    serialized = JSON.stringify(value, (_key, nested) => {
      if (
        nested === undefined
        || typeof nested === "function"
        || typeof nested === "symbol"
        || typeof nested === "bigint"
        || (typeof nested === "number" && !Number.isFinite(nested))
        || (nested !== null
          && typeof nested === "object"
          && Object.getOwnPropertySymbols(nested).length > 0)
      ) {
        throw new ProtocolError("result_serialization_failed");
      }
      return nested;
    });
  } catch {
    throw new ProtocolError("result_serialization_failed");
  }
  if (serialized === undefined) {
    throw new ProtocolError("result_serialization_failed");
  }
  return JSON.parse(serialized);
}

function validateOriginalResult(value, ancestors) {
  if (
    value === undefined
    || typeof value === "function"
    || typeof value === "symbol"
    || typeof value === "bigint"
    || (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new ProtocolError("result_serialization_failed");
  }
  if (value === null || typeof value !== "object") return;
  if (ancestors.has(value)) throw new ProtocolError("result_serialization_failed");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new ProtocolError("result_serialization_failed");
        }
      }
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") throw new ProtocolError("result_serialization_failed");
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor) throw new ProtocolError("result_serialization_failed");
      const nested = Object.hasOwn(descriptor, "value")
        ? descriptor.value
        : Reflect.get(value, key);
      validateOriginalResult(nested, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function boundedFailureMessage(value) {
  let message = "Runtime execution failed";
  try {
    if (value instanceof Error) {
      try {
        if (typeof value.message === "string") message = value.message;
      } catch {
        // Keep the stable fallback when an Error-like value has a hostile getter.
      }
    } else {
      message = String(value);
    }
  } catch {
    // Arbitrary thrown values are not trusted to support coercion.
  }
  const encoded = Buffer.from(message, "utf8");
  if (encoded.length <= MAX_FAILURE_MESSAGE_BYTES) return message;
  return encoded.subarray(0, MAX_FAILURE_MESSAGE_BYTES).toString("utf8");
}

function moduleSource(script) {
  return `export default async function (input, context) {\n${script}\n}\n`;
}

function isStartMessage(message) {
  return message?.type === "start"
    && typeof message.taskId === "string"
    && typeof message.script === "string"
    && typeof message.environmentPath === "string"
    && Object.hasOwn(message, "input")
    && message.context !== null
    && typeof message.context === "object";
}

function runMain() {
  const rawWrite = process.stdout.write.bind(process.stdout);
  let activeTask = null;

  const send = (message) => rawWrite(encodeFrame(message));
  const sendFailure = (taskId, code, error) => {
    const failure = {
      type: "failed",
      taskId: typeof taskId === "string" ? taskId : null,
      code,
      message: boundedFailureMessage(error),
    };
    try {
      send(failure);
    } catch {
      rawWrite(encodeFrame({
        type: "failed",
        taskId: null,
        code: "runtime_failed",
        message: "Runtime execution failed",
      }));
    }
  };
  const writeLog = (stream, chunk, encoding, callback) => {
    const message = Buffer.isBuffer(chunk) ? chunk.toString(encoding || "utf8") : String(chunk);
    send({ type: "log", taskId: activeTask?.taskId ?? null, stream, message });
    const done = typeof encoding === "function" ? encoding : callback;
    if (typeof done === "function") queueMicrotask(done);
    return true;
  };

  process.stdout.write = (chunk, encoding, callback) => writeLog("stdout", chunk, encoding, callback);
  process.stderr.write = (chunk, encoding, callback) => writeLog("stderr", chunk, encoding, callback);
  globalThis.console = Object.freeze({
    log: (...args) => writeLog("stdout", `${format(...args)}\n`),
    info: (...args) => writeLog("stdout", `${format(...args)}\n`),
    debug: (...args) => writeLog("stdout", `${format(...args)}\n`),
    warn: (...args) => writeLog("stderr", `${format(...args)}\n`),
    error: (...args) => writeLog("stderr", `${format(...args)}\n`),
  });

  async function start(message) {
    if (!isStartMessage(message)) {
      sendFailure(message?.taskId, "protocol_malformed_frame", "Invalid start message");
      return;
    }
    if (activeTask !== null) {
      sendFailure(message.taskId, "runtime_failed", "Runner is already executing a task");
      return;
    }

    const task = { taskId: message.taskId, cancelled: false };
    activeTask = task;
    const modulePath = resolve(message.environmentPath, `.localapp-run-${process.pid}-${randomUUID()}.mjs`);
    try {
      await writeFile(modulePath, moduleSource(message.script), { flag: "wx", mode: 0o600 });
      const generated = await import(`${pathToFileURL(modulePath).href}?run=${randomUUID()}`);
      const context = deepFreeze(sanitizedContext(message.context));
      const result = await generated.default(message.input, context);
      const normalized = serializableResult(result);
      if (!task.cancelled) {
        if (activeTask === task) activeTask = null;
        send({ type: "completed", taskId: task.taskId, result: normalized });
      }
    } catch (error) {
      if (!task.cancelled) {
        let code = "runtime_failed";
        try {
          if (error?.code === "result_serialization_failed") code = "result_serialization_failed";
        } catch {
          // Hostile thrown values cannot influence the stable failure code.
        }
        if (activeTask === task) activeTask = null;
        sendFailure(task.taskId, code, error);
      }
    } finally {
      await rm(modulePath, { force: true }).catch(() => {});
      if (activeTask === task) activeTask = null;
    }
  }

  function cancel(message) {
    if (message?.type !== "cancel" || typeof message.taskId !== "string") {
      sendFailure(message?.taskId, "protocol_malformed_frame", "Invalid cancel message");
      return;
    }
    if (activeTask?.taskId === message.taskId && !activeTask.cancelled) {
      activeTask.cancelled = true;
      send({ type: "cancelled", taskId: message.taskId });
    }
  }

  const decoder = new FrameDecoder();
  process.stdin.on("data", (chunk) => {
    try {
      for (const message of decoder.push(chunk)) {
        if (message?.type === "start") void start(message);
        else if (message?.type === "cancel") cancel(message);
        else sendFailure(message?.taskId, "protocol_malformed_frame", "Unknown message type");
      }
    } catch (error) {
      const code = error?.code === "protocol_frame_too_large"
        ? "protocol_frame_too_large"
        : "protocol_malformed_frame";
      sendFailure(null, code, code);
      process.stdin.pause();
    }
  });

  send({ type: "ready", protocolVersion: 1 });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) runMain();
