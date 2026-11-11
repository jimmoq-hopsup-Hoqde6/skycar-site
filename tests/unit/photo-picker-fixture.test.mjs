import assert from 'node:assert/strict';
import {test} from 'node:test';
import {photoApiRoute} from '../ui/support/photo-api-route.mjs';

const origin = 'http://127.0.0.1:3205';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
for (const role of ['care/journey', 'technician/jobs']) {
  const path = `/api/v1/${role}/${id}`;
  const matches = photoApiRoute(origin, path);
  test(`${role}: photo fixture includes snapshot, upload and private image paths`, () => {
    for (const suffix of ['', '?refresh=1', '/photos', '/photos/1', '/photos/1?kind=completion', '/completion-photos', '/completion-photos/2']) {
      assert.equal(matches(new URL(origin + path + suffix)), true, suffix || 'snapshot');
    }
  });
  test(`${role}: photo fixture excludes other origins, requests and prefix lookalikes`, () => {
    for (const url of [
      `https://example.com${path}/photos`,
      `http://127.0.0.1:3206${path}/photos`,
      `${origin}${path}b`,
      `${origin}${path}b/photos`,
      `${origin}${path.replace(id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')}/photos`,
      `${origin}${path.replace(role, 'other/jobs')}/photos`,
      `${origin}/unrelated${path}/photos`,
    ]) assert.equal(matches(new URL(url)), false, url);
  });
}
