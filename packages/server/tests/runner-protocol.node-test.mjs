import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const runnerPath = join(serverDir, "runner", "localapp-runner.mjs");
const { FrameDecoder, MAX_FRAME_BYTES, encodeFrame } = await import(pathToFileURL(runnerPath).href);

function startRunner() {
  const child = spawn(process.execPath, [runnerPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const decoder = new FrameDecoder();
  const messages = [];
  const waiters = [];
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) {
      messages.push(message);
      for (const waiter of [...waiters]) waiter();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  async function next(predicate, timeout = 3000) {
    const existing = messages.find(predicate);
    if (existing) return existing;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out waiting for runner message; stderr=${stderr}`));
      }, timeout);
      const check = () => {
        const found = messages.find(predicate);
        if (!found) return;
        cleanup();
        resolve(found);
      };
      const cleanup = () => {
        clearTimeout(timer);
        const index = waiters.indexOf(check);
        if (index >= 0) waiters.splice(index, 1);
      };
      waiters.push(check);
    });
  }

  return { child, messages, next };
}

async function withRunner(run) {
  const runner = startRunner();
  try {
    await runner.next((message) => message.type === "ready");
    await run(runner);
  } finally {
    runner.child.kill();
  }
}

test("frame codec handles fragmentation, coalescing, and stable errors", () => {
  const first = encodeFrame({ type: "cancel", taskId: "a" });
  const second = encodeFrame({ type: "cancel", taskId: "b" });
  assert.equal(first.subarray(0, 4).toString("ascii"), "LADP");
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(first.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(Buffer.concat([first.subarray(3), second])), [
    { type: "cancel", taskId: "a" },
    { type: "cancel", taskId: "b" },
  ]);

  assert.throws(
    () => new FrameDecoder().push(Buffer.from("NOPE0000")),
    { code: "protocol_malformed_frame" },
  );
  const oversized = Buffer.alloc(8);
  oversized.write("LADP");
  oversized.writeUInt32BE(MAX_FRAME_BYTES + 1, 4);
  assert.throws(
    () => new FrameDecoder().push(oversized),
    { code: "protocol_frame_too_large" },
  );
});

test("frame budget carries Server-boundary input, script, and result envelopes", () => {
  assert.doesNotThrow(() => encodeFrame({
    type: "start",
    taskId: "550e8400-e29b-41d4-a716-446655440000",
    script: "x".repeat(256 * 1024),
    input: "x".repeat(1024 * 1024 - 2),
    context: { app: { owner: "alice", name: "reports" } },
    environmentPath: "C:\\Users\\Ada\\AppData\\Local\\LocalApp\\js-envs\\hash",
  }));
  assert.doesNotThrow(() => encodeFrame({
    type: "completed",
    taskId: "550e8400-e29b-41d4-a716-446655440000",
    result: "x".repeat(1024 * 1024 - 2),
  }));
});

test("runner executes async bodies with imports, input, and frozen API-key-free context", async () => {
  const environmentPath = await mkdtemp(join(tmpdir(), "localapp-runner-"));
  const dependencyDir = join(environmentPath, "node_modules", "runner-fixture");
  await mkdir(dependencyDir, { recursive: true });
  await writeFile(
    join(dependencyDir, "package.json"),
    JSON.stringify({ name: "runner-fixture", type: "module", exports: "./index.mjs" }),
  );
  await writeFile(join(dependencyDir, "index.mjs"), "export const double = value => value * 2;\n");

  try {
    await withRunner(async ({ child, next }) => {
      child.stdin.write(encodeFrame({
        type: "start",
        taskId: "success",
        script: `
          const { double } = await import("runner-fixture");
          console.log("running", input.value);
          process.stdout.write("direct stdout");
          process.stderr.write("direct stderr");
          return {
            value: double(input.value),
            frozen: Object.isFrozen(context) && Object.isFrozen(context.app),
            hasApiKey: "apiKey" in context
              || "api_key" in context.app
              || "x-api-key" in context.headers
              || "X-Api-Key" in context.app.headers
              || "localapp-work-api-key" in context.app.nested,
          };
        `,
        input: { value: 4 },
        context: {
          apiKey: "secret",
          headers: { "x-api-key": "header-secret" },
          app: {
            name: "demo",
            api_key: "nested-secret",
            headers: { "X-Api-Key": "case-secret" },
            nested: { "localapp-work-api-key": "localapp-secret" },
          },
        },
        environmentPath,
      }));

      assert.match((await next((message) => message.type === "log")).message, /running 4/);
      assert.equal(
        (await next((message) => message.type === "log" && message.message === "direct stdout")).stream,
        "stdout",
      );
      assert.equal(
        (await next((message) => message.type === "log" && message.message === "direct stderr")).stream,
        "stderr",
      );
      assert.deepEqual(await next((message) => message.type === "completed"), {
        type: "completed",
        taskId: "success",
        result: { value: 8, frozen: true, hasApiKey: false },
      });
    });
  } finally {
    await rm(environmentPath, { recursive: true, force: true });
  }
});

test("runner emits stable runtime and result serialization failures", async () => {
  await withRunner(async ({ child, next }) => {
    for (const [taskId, script, code] of [
      ["runtime", "throw new Error('boom')", "runtime_failed"],
      ["cycle", "const value = {}; value.self = value; return value", "result_serialization_failed"],
      ["bigint", "return 1n", "result_serialization_failed"],
      ["undefined", "return undefined", "result_serialization_failed"],
      ["nested-undefined", "return { nested: { value: undefined } }", "result_serialization_failed"],
      ["nested-function", "return { nested: [() => 1] }", "result_serialization_failed"],
      ["nested-symbol", "return { nested: Symbol('value') }", "result_serialization_failed"],
      ["nan", "return { nested: Number.NaN }", "result_serialization_failed"],
      ["infinity", "return [Number.POSITIVE_INFINITY]", "result_serialization_failed"],
      ["array-hole", "return new Array(1)", "result_serialization_failed"],
      [
        "hidden-bigint",
        "const value = {}; Object.defineProperty(value, 'hidden', { value: 1n }); return value",
        "result_serialization_failed",
      ],
      [
        "hidden-function",
        "const value = {}; Object.defineProperty(value, 'hidden', { value() {} }); return value",
        "result_serialization_failed",
      ],
      [
        "hidden-symbol",
        "const value = {}; Object.defineProperty(value, Symbol('hidden'), { value: 1 }); return value",
        "result_serialization_failed",
      ],
      [
        "hidden-nonfinite",
        "const value = {}; Object.defineProperty(value, 'hidden', { value: Infinity }); return value",
        "result_serialization_failed",
      ],
      [
        "hidden-cycle",
        "const value = {}; Object.defineProperty(value, 'hidden', { value }); return value",
        "result_serialization_failed",
      ],
      [
        "throwing-accessor",
        "const value = {}; Object.defineProperty(value, 'hidden', { get() { throw new Error('nope') } }); return value",
        "result_serialization_failed",
      ],
      [
        "masked-by-to-json",
        "const value = {}; Object.defineProperty(value, 'hidden', { value: 1n }); Object.setPrototypeOf(value, { toJSON() { return { ok: true } } }); return value",
        "result_serialization_failed",
      ],
    ]) {
      child.stdin.write(encodeFrame({
        type: "start", taskId, script, input: null, context: {}, environmentPath: tmpdir(),
      }));
      const failed = await next((message) => message.type === "failed" && message.taskId === taskId);
      assert.equal(failed.code, code);
      assert.equal(typeof failed.message, "string");
    }
  });
});

test("runner safely reports arbitrary thrown values with hostile coercion", async () => {
  await withRunner(async ({ child, next }) => {
    for (const [taskId, script] of [
      [
        "throwing-to-string",
        "throw { toString() { throw new Error('toString failed') } }",
      ],
      [
        "throwing-primitive",
        "throw { [Symbol.toPrimitive]() { throw new Error('primitive failed') }, toString() { throw new Error('toString failed') } }",
      ],
      [
        "throwing-proxy",
        "throw new Proxy({}, { get() { throw new Error('get failed') } })",
      ],
    ]) {
      child.stdin.write(encodeFrame({
        type: "start", taskId, script, input: null, context: {}, environmentPath: tmpdir(),
      }));
      const failed = await next(
        (message) => message.type === "failed" && message.taskId === taskId,
      );
      assert.equal(failed.code, "runtime_failed");
      assert.equal(typeof failed.message, "string");
      assert.ok(encodeFrame(failed).length <= MAX_FRAME_BYTES);
    }
  });
});

test("runner bounds terminal failure messages to a valid protocol frame", async () => {
  await withRunner(async ({ child, next }) => {
    child.stdin.write(encodeFrame({
      type: "start",
      taskId: "oversized-error",
      script: `throw new Error("x".repeat(${MAX_FRAME_BYTES * 2}))`,
      input: null,
      context: {},
      environmentPath: tmpdir(),
    }));

    const failed = await next(
      (message) => message.type === "failed" && message.taskId === "oversized-error",
    );
    assert.equal(failed.code, "runtime_failed");
    assert.ok(encodeFrame(failed).length <= MAX_FRAME_BYTES);
    assert.ok(failed.message.length < MAX_FRAME_BYTES);
  });
});

test("runner acknowledges cancellation and suppresses completion", async () => {
  await withRunner(async ({ child, next, messages }) => {
    child.stdin.write(encodeFrame({
      type: "start",
      taskId: "cancel-me",
      script: "await new Promise(resolve => setTimeout(resolve, 100)); return 42;",
      input: null,
      context: {},
      environmentPath: tmpdir(),
    }));
    child.stdin.write(encodeFrame({ type: "cancel", taskId: "cancel-me" }));
    await next((message) => message.type === "cancelled" && message.taskId === "cancel-me");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(messages.some((message) => message.type === "completed"), false);
  });
});

test("runner frames protocol errors without writing raw stdout", async () => {
  const cases = [
    [Buffer.from("NOPE0000"), "protocol_malformed_frame"],
    [Buffer.from([0x4c, 0x41, 0x44, 0x50, 0x00, 0x20, 0x00, 0x01]), "protocol_frame_too_large"],
  ];
  for (const [frame, code] of cases) {
    const runner = startRunner();
    try {
      await runner.next((message) => message.type === "ready");
      runner.child.stdin.write(frame);
      const failed = await runner.next((message) => message.type === "failed");
      assert.equal(failed.code, code);
    } finally {
      runner.child.kill();
    }
  }
});
