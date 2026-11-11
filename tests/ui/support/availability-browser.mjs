// Wrapped select labels include their option text in Playwright's label matcher.
// Keep the match scoped to the dated row and anchored to the field name.
export const availabilityOffsetLabels = {
  start: /^Start offset/,
  end: /^End offset/,
};

// Refresh is also disabled during PUT. A GET-only wait must not wait for that
// PUT: concurrent-save fixtures deliberately release it after the GET settles.
export function availabilityReadSettled(root = document) {
  const status = root.querySelector('.technician-toolbar [role="status"]');
  return !!status && status.textContent !== 'Checking your saved hours…';
}
