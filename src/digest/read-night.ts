import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return parts !== null
    && isNight(parts[1])
    && Number(parts[2]) < 24
    && Number(parts[3]) < 60
    && Number(parts[4]) < 60
    && (parts[5] === undefined || (Number(parts[5]) < 24 && Number(parts[6]) < 60))
    && Number.isFinite(Date.parse(value));
}

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return isTimestamp(event.at)
    && typeof event.job === 'string' && event.job.trim().length > 0
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (typeof event.owner === 'string' || event.owner === null)
    && (!('error' in event) || typeof event.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const events: RunEvent[] = [];
  let badLines = 0;
  const lines = contents === '' ? [] : contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (isRunEvent(value)) events.push(value);
      else badLines += 1;
    } catch {
      badLines += 1;
    }
  }

  // Stable sorting gives later log lines precedence when two events share an instant.
  events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const jobs = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  for (const event of events) {
    counts[event.status] += 1;
    const row = jobs.get(event.job) ?? {
      job: event.job,
      owner: event.owner,
      runs: 0,
      retries: 0,
      lastStatus: event.status,
      lastError: null,
      firstAt: event.at,
      lastAt: event.at,
    };
    row.owner = event.owner;
    row.runs += 1;
    row.retries += event.status === 'retry' ? 1 : 0;
    row.lastStatus = event.status;
    if (event.error?.trim()) row.lastError = event.error;
    row.lastAt = event.at;
    jobs.set(event.job, row);
  }

  const rows = [...jobs.values()].sort((left, right) => (
    left.job < right.job ? -1 : left.job > right.job ? 1 : 0
  ));
  return { night, rows, badLines, counts };
};
