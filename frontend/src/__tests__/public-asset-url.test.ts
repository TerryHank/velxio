import { describe, expect, it } from 'vitest';
import { publicAssetUrl } from '../lib/publicAssetUrl';

describe('publicAssetUrl', () => {
  it('resolves root-relative assets under a sub-path deployment', () => {
    expect(publicAssetUrl('/boards/pi-pico-w.svg', '/velxio/')).toBe(
      '/velxio/boards/pi-pico-w.svg',
    );
  });

  it('keeps assets root-relative for a root deployment', () => {
    expect(publicAssetUrl('boards/pi-pico-w.svg', '/')).toBe('/boards/pi-pico-w.svg');
  });

  it('normalizes a base URL without a trailing slash', () => {
    expect(publicAssetUrl('/components/a4988.svg', '/velxio')).toBe(
      '/velxio/components/a4988.svg',
    );
  });
});
