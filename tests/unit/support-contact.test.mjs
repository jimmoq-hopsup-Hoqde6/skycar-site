import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSupportContact, readSupportContact, telHref } from '../../src/domain/care/support-contact.ts';

test('unset or blank config yields no contact (no hardcoded fallback)', () => {
  assert.deepEqual(readSupportContact({}), { email: null, phone: null });
  assert.deepEqual(readSupportContact({ SKYCAR_SUPPORT_EMAIL: '  ', SKYCAR_SUPPORT_PHONE: '' }), { email: null, phone: null });
  assert.equal(hasSupportContact(readSupportContact({})), false);
  assert.equal(hasSupportContact(null), false);
});

test('valid values are trimmed and kept', () => {
  const contact = readSupportContact({ SKYCAR_SUPPORT_EMAIL: ' help@example.test ', SKYCAR_SUPPORT_PHONE: ' +61 8 5550 0100 ' });
  assert.deepEqual(contact, { email: 'help@example.test', phone: '+61 8 5550 0100' });
  assert.equal(hasSupportContact(contact), true);
  assert.equal(hasSupportContact({ email: 'a@b.test', phone: null }), true);
});

test('invalid values are ignored rather than rendered', () => {
  for (const email of ['nope', 'a@b', 'a b@c.test', '<script>@x.test', `${'a'.repeat(250)}@x.test`]) assert.equal(readSupportContact({ SKYCAR_SUPPORT_EMAIL: email }).email, null, email);
  for (const phone of ['abc', '12', 'javascript:1', '+61 (8) 5550-0100 ext', '1'.repeat(40)]) assert.equal(readSupportContact({ SKYCAR_SUPPORT_PHONE: phone }).phone, null, phone);
});

test('tel href keeps only dialable characters', () => {
  assert.equal(telHref('+61 (8) 5550-0100'), 'tel:+61855500100');
});
