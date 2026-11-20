import { spawn, type ChildProcess } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProcessTreeController } from "./process-tree.js";

interface DailySchedule {
  timeZone: string;
  from: string;
  until: string;
  intervalMinutes: number;
}

interface ScriptDefinition {
  id: string;
  executable: string;
  cwd: string;
  args: string[];
  groupId?: string;
  envFrom: string[];
  timeoutSeconds: number;
  schedule: DailySchedule;
}

type Trigger = "schedule" | "manual";
type RunStatus = "succeeded" | "failed" | "timed_out" | "stopped";

const minuteMs = 60_000;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_.()-]*$/;
const manualTokenPattern = /^[A-Za-z0-9_-]{32,}$/;
const processTrees = new ProcessTreeController();

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function asMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function absolutePath(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\0") && path.isAbsolute(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string" && !item.includes("\0"));
}

export async function readScheduledScripts(filename: string, env: NodeJS.ProcessEnv) {
  if (!absolutePath(filename)) throw new Error("The scheduled scripts file path must be absolute");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(filename, "utf8"));
  } catch {
    throw new Error("Could not read the scheduled scripts file as JSON");
  }
  if (!Array.isArray(raw)) throw new Error("The scheduled scripts file must contain a JSON array");
  const scripts = new Map<string, ScheduledScript>();
  for (const [index, entry] of raw.entries()) {
    const error = new Error(`Invalid scheduled script at index ${index}`);
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw error;
    const fields = ["id", "executable", "cwd", "args", "groupId", "envFrom", "timeoutSeconds", "schedule", "manualRunTokenEnv"];
    if (Object.keys(entry).some(key => !fields.includes(key))) throw error;
    const { id, executable, cwd, args = [], groupId, envFrom = [], timeoutSeconds = 300, schedule, manualRunTokenEnv } =
      entry as Partial<ScriptDefinition> & { manualRunTokenEnv?: string };
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || scripts.has(id)) throw error;
    if (!absolutePath(executable) || !absolutePath(cwd) || !stringArray(args)) throw error;
    if (groupId !== undefined && (typeof groupId !== "string" || !/^[0-9a-f]{20}$/.test(groupId))) throw error;
    if (!stringArray(envFrom) || envFrom.some(key => !envNamePattern.test(key))) throw error;
    let manualRunTokenHash: Buffer | undefined;
    if (manualRunTokenEnv !== undefined) {
      if (typeof manualRunTokenEnv !== "string" || !envNamePattern.test(manualRunTokenEnv)) throw error;
      const token = env[manualRunTokenEnv];
      if (typeof token !== "string" || !manualTokenPattern.test(token)) {
        throw new Error(`Scheduled script at index ${index} requires a valid manual run token`);
      }
      manualRunTokenHash = tokenDigest(token);
    }
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) throw error;
    if (!schedule || typeof schedule.timeZone !== "string" || Object.keys(schedule).length !== 4
      || typeof schedule.from !== "string" || !timePattern.test(schedule.from)
      || typeof schedule.until !== "string" || !(timePattern.test(schedule.until) || schedule.until === "24:00")
      || asMinutes(schedule.from) >= asMinutes(schedule.until)
      || !Number.isInteger(schedule.intervalMinutes) || schedule.intervalMinutes < 1 || schedule.intervalMinutes > 1440) {
      throw error;
    }
    let clock: Intl.DateTimeFormat;
    try {
      clock = new Intl.DateTimeFormat("en-GB", {
        timeZone: schedule.timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      throw error;
    }
    const { timeZone, from, until, intervalMinutes } = schedule;
    const definition = {
      id, executable, cwd, args, groupId, envFrom, timeoutSeconds,
      schedule: { timeZone, from, until, intervalMinutes },
    };
    scripts.set(id, new ScheduledScript(definition, clock, env, manualRunTokenHash));
  }
  return scripts;
}

class ScheduledScript {
  private active?: { done: Promise<void>; stop: () => void };
  private lastRun: { trigger: Trigger; status: RunStatus; startedAt: string; finishedAt: string } | null = null;

  constructor(
    private readonly definition: ScriptDefinition,
    private readonly clock: Intl.DateTimeFormat,
    private readonly env: NodeJS.ProcessEnv,
    private readonly manualRunTokenHash: Buffer | undefined,
  ) {}

  get groupId(): string | undefined {
    return this.definition.groupId;
  }

  summary() {
    return {
      id: this.definition.id,
      schedule: this.definition.schedule,
      manualRunEnabled: this.manualRunTokenHash !== undefined,
      running: this.active !== undefined,
      lastRun: this.lastRun,
    };
  }

  allowsManualRun(token: unknown): boolean {
    return typeof token === "string" && this.manualRunTokenHash !== undefined
      && timingSafeEqual(tokenDigest(token), this.manualRunTokenHash);
  }

  checkSchedule(now: Date): void {
    const { from, until, intervalMinutes } = this.definition.schedule;
    const time = this.clock.format(now);
    if (time >= from && time < until && (asMinutes(time) - asMinutes(from)) % intervalMinutes === 0) {
      this.run("schedule", now);
    }
  }

  run(trigger: Trigger, now = new Date()): boolean {
    if (this.active) return false;
    const startedAt = now.toISOString();
    const finish = (status: RunStatus) => {
      this.lastRun = { trigger, status, startedAt, finishedAt: new Date().toISOString() };
      this.active = undefined;
    };
    const { executable, cwd, args, envFrom, timeoutSeconds } = this.definition;
    const env: NodeJS.ProcessEnv = Object.create(null);
    for (const key of envFrom) {
      const value = this.env[key];
      if (typeof value === "string") env[key] = value;
    }
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd, env, shell: false, stdio: "ignore", windowsHide: true, detached: processTrees.platform !== "win32",
      });
    } catch {
      finish("failed");
      return true;
    }
    let termination: Promise<RunStatus> | undefined;
    const terminate = (reason: "timed_out" | "stopped") => {
      if (termination || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
      termination = processTrees.signalTree(child.pid, true).then(() => reason, () => {
        child.kill("SIGKILL");
        return "failed";
      });
    };
    const timeout = setTimeout(() => terminate("timed_out"), timeoutSeconds * 1000);
    let failed = false;
    const done = new Promise<void>(resolve => {
      child.on("error", () => { failed = true; });
      child.once("close", async code => {
        clearTimeout(timeout);
        finish(termination ? await termination : (!failed && code === 0 ? "succeeded" : "failed"));
        resolve();
      });
    });
    this.active = { done, stop: () => terminate("stopped") };
    return true;
  }

  stop(): Promise<void> | undefined {
    this.active?.stop();
    return this.active?.done;
  }
}

export function scheduleScriptChecks(scripts: Iterable<ScheduledScript>): () => void {
  const jobs = Array.from(scripts);
  let timer: NodeJS.Timeout;
  const arm = () => {
    timer = setTimeout(() => {
      const now = new Date();
      for (const script of jobs) script.checkSchedule(now);
      arm();
    }, minuteMs - Date.now() % minuteMs);
    timer.unref();
  };
  arm();
  return () => clearTimeout(timer);
}
