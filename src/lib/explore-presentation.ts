/** An omitted or blank optional number is not a zero-byte constraint. */
export function optionalBytes(value: string | null, scale = 1): number | undefined {
  if (!value?.trim()) return undefined;
  const bytes = Number(value) * scale;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined;
}
