import { clampFocal, focalToContentPosition } from '../cover-focal';

describe('cover focal', () => {
  it('clamps into 0..1', () => {
    expect(clampFocal({ x: -0.2, y: 1.4 })).toEqual({ x: 0, y: 1 });
    expect(clampFocal({ x: 0.3, y: 0.7 })).toEqual({ x: 0.3, y: 0.7 });
  });
  it('maps to percent contentPosition; null = center', () => {
    expect(focalToContentPosition({ x: 0.25, y: 0.5 })).toEqual({ left: '25%', top: '50%' });
    expect(focalToContentPosition(null)).toBe('center');
  });
});
