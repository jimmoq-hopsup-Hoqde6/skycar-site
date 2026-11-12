import test from 'node:test';
import assert from 'node:assert/strict';
import {serverSecret} from '../../src/server/supabase/secret-config.mjs';
const fake='sb_secret_synthetic_fixture_0123456789';
test('server keys accept raw secret and normalize accidental paste whitespace and quotes',()=>{
  for (const key of [fake,` ${fake}\n`,`"${fake}"`,`'${fake}'`]) assert.equal(serverSecret(key),fake);
});
test('browser keys, ordinary passwords and malformed values are rejected without value disclosure',()=>{
  for(const key of [undefined,'sb_publishable_synthetic_fixture_0123456789','private-test-password','sb_secret_','invalid legacy key']) {
    assert.throws(()=>serverSecret(key),{message:'Supabase server key configuration is invalid'});
  }
});
test('legacy anon keys cannot be used as a server credential',()=>{
  const token=role=>`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role})).toString('base64url')}.syntheticSignature`;
  assert.throws(()=>serverSecret(token('anon')));
  assert.equal(serverSecret(token('service_role')),token('service_role'));
});
