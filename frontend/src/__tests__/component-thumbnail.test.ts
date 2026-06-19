import { describe, expect, it } from 'vitest';
import { hasInlineSvgThumbnail } from '../components/componentThumbnail';

describe('hasInlineSvgThumbnail', () => {
  it('accepts an inline SVG with leading whitespace', () => {
    expect(hasInlineSvgThumbnail('  <svg width="64" height="64"></svg>')).toBe(true);
  });

  it('rejects empty and external thumbnail values', () => {
    expect(hasInlineSvgThumbnail('')).toBe(false);
    expect(hasInlineSvgThumbnail('/boards/pi-pico-w.svg')).toBe(false);
    expect(hasInlineSvgThumbnail(undefined)).toBe(false);
  });
});
