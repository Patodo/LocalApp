import type { FastifyInstance } from "fastify";
import { insertRequestLogs, insertPageViews, type RequestLogEntry, type PageViewEntry } from "./meta-sqlite.js";

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE = 100;

let requestBuffer: RequestLogEntry[] = [];
let pageViewBuffer: PageViewEntry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function flush(): void {
  const requests = requestBuffer;
  const views = pageViewBuffer;
  requestBuffer = [];
  pageViewBuffer = [];
  try {
    insertRequestLogs(requests);
    insertPageViews(views);
  } catch {
    // Logging should never crash the server
  }
}

export function pushRequestLog(entry: RequestLogEntry): void {
  requestBuffer.push(entry);
  if (requestBuffer.length >= MAX_BUFFER_SIZE) flush();
}

export function pushPageView(entry: PageViewEntry): void {
  pageViewBuffer.push(entry);
  if (pageViewBuffer.length >= MAX_BUFFER_SIZE) flush();
}

export function startRequestLogger(): void {
  if (timer) return;
  timer = setInterval(flush, FLUSH_INTERVAL_MS);
}

export function stopRequestLogger(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  flush();
}
