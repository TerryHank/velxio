export function hasInlineSvgThumbnail(thumbnail: unknown): thumbnail is string {
  return typeof thumbnail === 'string' && thumbnail.trim().startsWith('<svg');
}
