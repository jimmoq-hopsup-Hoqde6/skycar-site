import assert from 'node:assert/strict';
import test from 'node:test';
import {availabilityOffsetLabels, availabilityReadSettled} from '../ui/support/availability-browser.mjs';

test('offset selectors match wrapped label text, including both options, without mixing fields', () => {
  for (const suffix of ['', '+09:30+10:30', ' +09:30 +10:30']) {
    assert.match(`Start offset${suffix}`, availabilityOffsetLabels.start);
    assert.match(`End offset${suffix}`, availabilityOffsetLabels.end);
    assert.doesNotMatch(`End offset${suffix}`, availabilityOffsetLabels.start);
    assert.doesNotMatch(`Start offset${suffix}`, availabilityOffsetLabels.end);
  }
  for (const unrelated of ['Starts', 'Ends', 'Date', 'Other Start offset']) {
    assert.doesNotMatch(unrelated, availabilityOffsetLabels.start);
    assert.doesNotMatch(unrelated, availabilityOffsetLabels.end);
  }
});

function toolbar(text, writePending = false) {
  return {
    refresh: {disabled: writePending},
    querySelector(selector) {
      assert.equal(selector, '.technician-toolbar [role="status"]');
      return text === null ? null : {textContent: text};
    },
  };
}

test('revalidation waits for its own status, including absence and failed verification', () => {
  assert.equal(availabilityReadSettled(toolbar(null)), false);
  assert.equal(availabilityReadSettled(toolbar('Checking your saved hours…')), false);
  assert.equal(availabilityReadSettled(toolbar('Saved revision 3')), true);
  assert.equal(availabilityReadSettled(toolbar('Access not verified')), true);
});

test('a pending write cannot deadlock the fixture waiting for a finished revalidation', () => {
  const duringRead = toolbar('Checking your saved hours…', true);
  assert.equal(duringRead.refresh.disabled, true);
  assert.equal(availabilityReadSettled(duringRead), false);
  const afterRead = toolbar('Saved revision 3', true);
  assert.equal(afterRead.refresh.disabled, true, 'PUT is still deliberately held by the fixture');
  assert.equal(availabilityReadSettled(afterRead), true, 'GET can finish before the held PUT is released');
});
