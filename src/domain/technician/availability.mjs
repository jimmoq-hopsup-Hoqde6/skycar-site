const TIMEZONE = 'Australia/Adelaide';
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OFFSETS = new Set(['+09:30', '+10:30']);
const WEEKLY_KEYS = ['weekday', 'starts_at', 'ends_at'];
const EXCEPTION_KEYS = ['date', 'windows'];
const EXCEPTION_WINDOW_KEYS = ['starts_at', 'starts_at_offset', 'ends_at', 'ends_at_offset'];
const COMMAND_KEYS = ['expected_revision', 'timezone', 'weekly_windows', 'exceptions'];
const SCHEDULE_KEYS = ['timezone', 'revision', 'weekly_windows', 'exceptions', 'evaluated_at'];

export class AvailabilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AvailabilityError';
  }
}

function fail(message) {
  throw new AvailabilityError(message);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function isoDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function adelaideToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const read = type => parts.find(part => part.type === type)?.value;
  const date = `${read('year')}-${read('month')}-${read('day')}`;
  if (!isoDate(date)) fail('Adelaide date could not be resolved.');
  return date;
}

export function addCalendarMonths(iso, months) {
  if (!isoDate(iso) || !Number.isInteger(months)) fail('Date could not be resolved.');
  const [year, month, day] = iso.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
  const resolved = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(day, lastDay)));
  return resolved.toISOString().slice(0, 10);
}

function minutes(value) {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function assertWindows(windows, label, boundary) {
  if (!Array.isArray(windows)) fail(`${label} must be a list.`);
  let previousEnd = null;
  const instants = [];
  for (const window of windows) {
    const start = minutes(window?.starts_at);
    const end = minutes(window?.ends_at);
    if (!exactKeys(window, boundary ? EXCEPTION_WINDOW_KEYS : ['starts_at', 'ends_at']) || start === null || end === null) {
      fail('Use 24-hour hours and minutes on the same Adelaide day.');
    }
    if (end - start < 15) fail('Each window must last at least 15 minutes and must not cross midnight.');
    if (previousEnd !== null && start <= previousEnd) fail('Keep hours in order, and merge windows that touch or overlap.');
    if (boundary) {
      if (!OFFSETS.has(window.starts_at_offset) || !OFFSETS.has(window.ends_at_offset)) fail('Use the Adelaide offset for that date.');
      if (!adelaideBoundaryOk(boundary, window.starts_at, window.starts_at_offset)
        || !adelaideBoundaryOk(boundary, window.ends_at, window.ends_at_offset)) {
        fail('That local time is missing or ambiguous in Adelaide. Choose the offset that matches the date.');
      }
      // Both boundaries may be valid in the repeated fall-back hour while the
      // selected offsets reverse the interval or overlap another wall-disjoint one.
      const startsAt = Date.parse(`${boundary}T${window.starts_at}:00${window.starts_at_offset}`);
      const endsAt = Date.parse(`${boundary}T${window.ends_at}:00${window.ends_at_offset}`);
      if (endsAt <= startsAt) fail('With these Adelaide offsets, the end must be after the start.');
      if (instants.some(other => startsAt < other.endsAt && other.startsAt < endsAt)) {
        fail('These dated hours overlap after applying their Adelaide offsets.');
      }
      instants.push({ startsAt, endsAt });
    }
    previousEnd = end;
  }
}

export function adelaideBoundaryOk(date, time, offset) {
  if (!isoDate(date) || minutes(time) === null || !OFFSETS.has(offset)) return false;
  const instant = new Date(`${date}T${time}:00${offset}`);
  if (Number.isNaN(instant.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const read = type => parts.find(part => part.type === type)?.value ?? '';
  const wallDate = `${read('year')}-${read('month')}-${read('day')}`;
  const wallTime = `${read('hour')}:${read('minute')}`;
  const zone = read('timeZoneName').replace('GMT', '');
  const normalized = zone.startsWith('+') || zone.startsWith('-')
    ? `${zone[0]}${zone.slice(1).padStart(5, '0')}`
    : zone;
  return wallDate === date && wallTime === time && normalized === offset;
}

function weeklyWindows(value) {
  if (!Array.isArray(value) || value.length > 28) fail('Publish at most 28 weekly windows.');
  let previousDay = 0;
  let previousEnd = null;
  for (const window of value) {
    if (!exactKeys(window, WEEKLY_KEYS) || !Number.isInteger(window.weekday) || window.weekday < 1 || window.weekday > 7) {
      fail('Weekly hours need a Monday–Sunday day and a start and end.');
    }
    if (window.weekday < previousDay) fail('List weekly hours from Monday to Sunday.');
    if (window.weekday !== previousDay) previousEnd = null;
    assertWindows([{ starts_at: window.starts_at, ends_at: window.ends_at }], 'Weekly hours', null);
    const start = minutes(window.starts_at);
    const end = minutes(window.ends_at);
    if (previousEnd !== null && start <= previousEnd) fail('Keep hours in order, and merge windows that touch or overlap.');
    previousDay = window.weekday;
    previousEnd = end;
  }
  return value;
}

function exceptions(value, today) {
  if (!Array.isArray(value) || value.length > 366) fail('Publish at most 366 dated exceptions.');
  const latest = addCalendarMonths(today, 18);
  let previousDate = '';
  for (const exception of value) {
    if (!exactKeys(exception, EXCEPTION_KEYS) || !isoDate(exception.date)) fail('Each exception needs a real calendar date.');
    if (exception.date < today || exception.date > latest) fail('Dated hours must be from today through the next 18 months in Adelaide.');
    if (exception.date <= previousDate) fail('List each date once, in calendar order.');
    if (!Array.isArray(exception.windows) || exception.windows.length > 8) fail('A dated exception can replace that day with at most 8 windows.');
    assertWindows(exception.windows, exception.date, exception.date);
    previousDate = exception.date;
  }
  return value;
}

export function readAvailabilityCommand(value, now = new Date()) {
  if (!exactKeys(value, COMMAND_KEYS)) fail('Send the revision, Adelaide timezone, weekly hours and dated exceptions only.');
  if (!Number.isInteger(value.expected_revision) || value.expected_revision < 0) fail('Refresh the saved hours before replacing them.');
  if (value.timezone !== TIMEZONE) fail('This schedule uses Australia/Adelaide.');
  const today = adelaideToday(now);
  return {
    expectedRevision: value.expected_revision,
    payload: {
      timezone: TIMEZONE,
      weekly_windows: weeklyWindows(value.weekly_windows),
      exceptions: exceptions(value.exceptions, today),
    },
  };
}

function finiteTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

export function readAvailabilitySchedule(value) {
  if (!exactKeys(value, SCHEDULE_KEYS) || value.timezone !== TIMEZONE
    || !Number.isInteger(value.revision) || value.revision < 0 || !finiteTimestamp(value.evaluated_at)) {
    fail('The saved schedule could not be verified.');
  }
  weeklyWindows(value.weekly_windows);
  if (!Array.isArray(value.exceptions) || value.exceptions.length > 366) fail('The saved schedule could not be verified.');
  for (const exception of value.exceptions) {
    if (!exactKeys(exception, EXCEPTION_KEYS) || !isoDate(exception.date) || !Array.isArray(exception.windows) || exception.windows.length > 8) {
      fail('The saved schedule could not be verified.');
    }
    assertWindows(exception.windows, exception.date, exception.date);
  }
  let previous = '';
  for (const exception of value.exceptions) {
    if (exception.date <= previous) fail('The saved schedule could not be verified.');
    previous = exception.date;
  }
  return value;
}

export function readAvailabilityResult(value) {
  if (!exactKeys(value, ['revision', 'replayed']) || !Number.isInteger(value.revision) || value.revision < 1 || typeof value.replayed !== 'boolean') {
    fail('The saved schedule could not be verified.');
  }
  return value;
}
