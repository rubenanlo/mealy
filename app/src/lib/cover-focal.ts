export interface CoverFocal {
  x: number;
  y: number;
}

export function clampFocal(f: CoverFocal): CoverFocal {
  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 100) / 100));
  return { x: clamp(f.x), y: clamp(f.y) };
}

/** expo-image contentPosition value for a stored focal ({left,top} percents). */
export function focalToContentPosition(
  f: CoverFocal | null
): { left: `${number}%`; top: `${number}%` } | 'center' {
  if (!f) return 'center';
  return { left: `${Math.round(f.x * 100)}%` as `${number}%`, top: `${Math.round(f.y * 100)}%` as `${number}%` };
}
