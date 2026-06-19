import { describe, expect, it } from 'vitest';
import { buildUpstreamUrl } from '../../functions/api/[[path]]';

describe('Cloudflare Pages API proxy', () => {
  it('preserves the API path and query string', () => {
    expect(
      buildUpstreamUrl(
        'http://38.76.201.240:8002',
        'https://velxio.pages.dev/api/compile/status/abc?verbose=1',
      ),
    ).toBe('http://38.76.201.240:8002/api/compile/status/abc?verbose=1');
  });

  it('normalizes a trailing slash on the configured origin', () => {
    expect(
      buildUpstreamUrl('http://38.76.201.240:8002/', 'https://velxio.pages.dev/api/health'),
    ).toBe('http://38.76.201.240:8002/health');
  });
});
