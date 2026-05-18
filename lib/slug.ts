export function getPrototypeSlug(): string {
  const slug = process.env.PROTOTYPE_SLUG;
  if (!slug || slug.length < 8) {
    throw new Error('PROTOTYPE_SLUG must be set to a value of at least 8 characters');
  }
  return slug;
}

export function isValidSlug(candidate: string): boolean {
  try { return candidate === getPrototypeSlug(); } catch { return false; }
}
