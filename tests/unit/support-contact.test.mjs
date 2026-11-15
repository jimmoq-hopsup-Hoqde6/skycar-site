import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SUPPORT_EMAIL, hasSupportContact, readSupportContact, telHref } from '../../src/domain/care/support-contact.ts';

test('email defaults to info@skycar.au when unset or blank; the phone has no default', () => {
  assert.equal(DEFAULT_SUPPORT_EMAIL, 'info@skycar.au');
  for (const env of [{}, { SKYCAR_SUPPORT_EMAIL: '' }, { SKYCAR_SUPPORT_EMAIL: '  ', SKYCAR_SUPPORT_PHONE: '' }, { SKYCAR_SUPPORT_EMAIL: undefined, SKYCAR_SUPPORT_PHONE: undefined }]) {
    assert.deepEqual(readSupportContact(env), { email: 'info@skycar.au', phone: null }, JSON.stringify(env));
  }
  assert.equal(hasSupportContact(readSupportContact({})), true);
  assert.equal(hasSupportContact(null), false);
  assert.equal(hasSupportContact({ email: null, phone: null }), false);
});

test('phone stays hidden unless SKYCAR_SUPPORT_PHONE is set to a valid number', () => {
  assert.equal(readSupportContact({}).phone, null);
  assert.equal(readSupportContact({ SKYCAR_SUPPORT_EMAIL: 'help@example.test' }).phone, null);
  assert.equal(readSupportContact({ SKYCAR_SUPPORT_PHONE: '   ' }).phone, null);
  assert.equal(readSupportContact({ SKYCAR_SUPPORT_PHONE: 'not a number' }).phone, null);
  assert.equal(readSupportContact({ SKYCAR_SUPPORT_PHONE: '+61 8 5550 0100' }).phone, '+61 8 5550 0100');
});

test('valid values are trimmed and kept', () => {
  const contact = readSupportContact({ SKYCAR_SUPPORT_EMAIL: ' help@example.test ', SKYCAR_SUPPORT_PHONE: ' +61 8 5550 0100 ' });
  assert.deepEqual(contact, { email: 'help@example.test', phone: '+61 8 5550 0100' });
  assert.equal(hasSupportContact(contact), true);
  assert.equal(hasSupportContact({ email: 'a@b.test', phone: null }), true);
});

test('invalid values are never rendered: a bad email falls back to the default, a bad phone is hidden', () => {
  for (const email of ['nope', 'a@b', 'a b@c.test', '<script>@x.test', 'a@b.test?bcc=x@y.test', 'a@b.test?subject=hi', 'a@b.test&cc=x@y.test', 'a&b@c.test', 'a?b@c.test', 'a@b?.test', '?@b.test', 'a@b.test?', `${'a'.repeat(250)}@x.test`]) assert.equal(readSupportContact({ SKYCAR_SUPPORT_EMAIL: email }).email, DEFAULT_SUPPORT_EMAIL, email);
  for (const phone of ['abc', '12', 'javascript:1', '+61 (8) 5550-0100 ext', '1'.repeat(40)]) assert.equal(readSupportContact({ SKYCAR_SUPPORT_PHONE: phone }).phone, null, phone);
});

test('tel href keeps only dialable characters', () => {
  assert.equal(telHref('+61 (8) 5550-0100'), 'tel:+61855500100');
});

test('a valid override containing neither ? nor & is still accepted (plus-addressing, dots, hyphens)', () => {
  for (const email of ['help@example.test', 'first.last+care@sub-domain.example.test', 'a_b@x.co']) assert.equal(readSupportContact({ SKYCAR_SUPPORT_EMAIL: email }).email, email, email);
});
