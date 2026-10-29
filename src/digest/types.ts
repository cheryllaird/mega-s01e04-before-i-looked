export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  /** Owner from the latest valid event, including null. */
  owner: string | null;
  /** Total valid events for this job, including retries and failures. */
  runs: number;
  /** Number of valid events with retry status. */
  retries: number;
  lastStatus: DigestStatus;
  /** Latest non-empty event error, retained after a later success. */
  lastError: string | null;
  /** Original timestamps with their log offsets preserved. */
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  night: string;
  /** One row per job, sorted by job by the shared reader. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid events by status, rather than final job statuses. */
  counts: {
    ok: number;
    retry: number;
    fail: number;
  };
};

/** Returns null for an invalid night or a missing night file. */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
