import { expect, it } from 'vitest';
import { endpointFor } from '../../apps/client/src/model.js';
it.each(['not a url', 'ftp://example.com', 'javascript:alert(1)', 'ws://user:password@example.com', 'ws://example.com/?secret=x'])('rejects unusable or credential-bearing server endpoint %s', override => {
  expect(() => endpointFor('https://campus.example', override)).toThrow(/VITE_SERVER_URL/);
});
