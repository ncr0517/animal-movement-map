// Open-call state, shared by the Worker and the build (the static fallback snapshot).

export const DAY = 86400_000;

// A real calendar date written YYYY-MM-DD (the only deadline format the research schema allows).
export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// open | closed | forthcoming | rolling-or-unstated, or null for records that are not open calls.
// A deadline more than a day in the past closes the call, whatever a reviewed override says; otherwise a
// reviewed override wins, and without one the deadline decides. A deadline that is not a real
// YYYY-MM-DD date says nothing reliable, so the call is shown as having no stated deadline.
export function callState(ev, now = Date.now()) {
  if (ev.type !== 'open_call') return null;
  const deadline = isIsoDate(ev.deadline) ? Date.parse(`${ev.deadline}T00:00:00Z`) : null;
  if (deadline !== null && deadline + DAY < now) return 'closed';
  if (ev.call_state) return ev.call_state;
  return deadline === null ? 'rolling-or-unstated' : 'open';
}
