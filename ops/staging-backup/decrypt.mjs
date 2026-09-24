import { createDecipheriv, privateDecrypt, constants, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function decryptBundle(envelope, privateKey) {
  if (envelope.header.format !== 'skycar-backup-v1' || envelope.header.cipher !== 'AES-256-GCM' || envelope.header.wrapping !== 'RSA-OAEP-SHA256') throw new Error('Invalid format');
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.wrappedKey, 'base64'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(JSON.stringify(envelope.header)));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    const files = JSON.parse(gunzipSync(plain, { maxOutputLength: 160 * 1024 * 1024 }).toString());
    if (Object.keys(files).sort().join(',') !== 'data.sql,roles.sql,schema.sql') throw new Error('Invalid inventory');
    for (const [name, bytes] of Object.entries(files)) {
      const digest = createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex');
      if (envelope.header.files.find(f => f.name === name)?.sha256 !== digest) throw new Error('Invalid checksum');
    }
    return files;
  } finally { key.fill(0); }
}

// Offline administrator helper. Never use in a public Actions job or publish output.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [archive, keyFile, directory] = process.argv.slice(2);
    const files = decryptBundle(JSON.parse(readFileSync(archive, 'utf8')), readFileSync(keyFile));
    mkdirSync(directory, { mode: 0o700 });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(directory, name), Buffer.from(bytes, 'base64'), { mode: 0o600, flag: 'wx' });
    console.log('Decryption and checksums verified; database restore is a separate NOT RUN gate.');
  } catch { console.error('Private backup recovery failed.'); process.exitCode = 1; }
}
