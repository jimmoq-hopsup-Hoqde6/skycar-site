// Shared fixtures for 20261115090000 (booking availability enforcement). A technician-linked expert
// must have published availability that covers a slot before a quote, selection or confirmation.
// Slots built with tomorrowAt() sit inside one Adelaide day, so they never cross local midnight
// whatever time the suite runs.
export const OPEN_WEEK = JSON.stringify({
  timezone: 'Australia/Adelaide',
  weekly_windows: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, starts_at: '00:00', ends_at: '23:59' })),
  exceptions: [],
});
export const weekOf = (starts_at, ends_at) => JSON.stringify({
  timezone: 'Australia/Adelaide',
  weekly_windows: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, starts_at, ends_at })),
  exceptions: [],
});
// SQL expression: tomorrow (Adelaide) at the given wall-clock hour, as timestamptz.
export const tomorrowAt = hours =>
  `((date_trunc('day', clock_timestamp() at time zone 'Australia/Adelaide') + interval '1 day' + make_interval(hours => ${Number(hours)})) at time zone 'Australia/Adelaide')`;
// Statement that publishes `payload` for technician `tech` (service_role, expected revision `revision`).
export const publishAvailability = (quote, tech, payload = OPEN_WEEK, revision = 0) =>
  `begin;set local role service_role;select public.care_technician_replace_availability(${quote(tech)}::uuid,gen_random_uuid(),${revision},${quote(payload)}::jsonb);commit;`;
