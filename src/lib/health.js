// Whether the hourly refresher is keeping up. A stopped refresher must not look like "Live data".
// Reported in /api/snapshot (`refresher`) and /api/health; the page turns its status dot amber on "degraded".

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// lastAttempt: the newest refresh_runs row (finished or not); lastFinishedAt: finished_at of the newest finished
// run; lastSourceCheck: the newest sources.last_checked.
export function refresherHealth({ lastAttempt, lastFinishedAt, lastSourceCheck }, now = Date.now()) {
  const base = {
    last_attempt_started_at: lastAttempt?.started_at || null,
    last_attempt_finished_at: lastAttempt?.finished_at || null,
    last_finished_at: lastFinishedAt || null,
    last_source_check: lastSourceCheck || null,
  };
  const age = (t) => (t ? now - Date.parse(t) : Infinity);
  if (!lastAttempt) return { status: 'waiting', detail: 'No refresh has run yet.', ...base };
  if (!lastAttempt.finished_at && age(lastAttempt.started_at) > 15 * MINUTE) {
    return { status: 'degraded', detail: 'The latest refresh run did not finish.', ...base };
  }
  if (age(lastFinishedAt) > 3 * HOUR) return { status: 'degraded', detail: 'No refresh run has finished in the last 3 hours.', ...base };
  if (lastSourceCheck && age(lastSourceCheck) > 26 * HOUR) return { status: 'degraded', detail: 'No source has been checked in the last 26 hours.', ...base };
  return { status: 'ok', detail: null, ...base };
}
