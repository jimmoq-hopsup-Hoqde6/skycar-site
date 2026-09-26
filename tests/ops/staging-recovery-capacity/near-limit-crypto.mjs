import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { encryptBundle } from '../../../ops/staging-backup/backup.mjs';
import { decryptBundle } from '../../../ops/staging-backup/decrypt.mjs';

const FILE_BYTES = 31 * 1024 * 1024;
const names = ['roles.sql', 'schema.sql', 'data.sql'];
const files = {};

for (const [index, name] of names.entries()) {
  // SQL comments keep the fixture harmless while producing a near-limit decoded
  // JSON inventory. This case measures crypto/decompression, not SQL restore.
  const line = Buffer.from(`-- synthetic-capacity-${index}-${name}\n`);
  const bytes = Buffer.allocUnsafe(FILE_BYTES);
  for (let offset = 0; offset < bytes.length; offset += line.length) {
    line.copy(bytes, offset, 0, Math.min(line.length, bytes.length - offset));
  }
  files[name] = bytes.toString('base64');
  bytes.fill(0);
}

const metadata = {
  files: names.map(name => ({
    name,
    sha256: createHash('sha256').update(Buffer.from(files[name], 'base64')).digest('hex'),
  })),
};
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const envelope = encryptBundle(files, publicKey, metadata);
const recovered = decryptBundle(envelope, privateKey);

assert.deepEqual(Object.keys(recovered).sort(), names.slice().sort());
for (const name of names) {
  assert.equal(
    createHash('sha256').update(Buffer.from(recovered[name], 'base64')).digest('hex'),
    metadata.files.find(file => file.name === name).sha256,
  );
}

const jsonBytes = Buffer.byteLength(JSON.stringify(files));
assert.ok(jsonBytes < 160 * 1024 * 1024, 'decoded JSON must remain inside the accepted recovery bound');
assert.ok(jsonBytes > 120 * 1024 * 1024, 'fixture must exercise a near-limit decoded inventory');

process.stdout.write(`${JSON.stringify({
  classification: 'synthetic-crypto-only',
  passed: true,
  logicalBytes: FILE_BYTES * names.length,
  jsonBytes,
  envelopeBytes: Buffer.byteLength(JSON.stringify(envelope)),
  fileBytes: FILE_BYTES,
})}\n`);
