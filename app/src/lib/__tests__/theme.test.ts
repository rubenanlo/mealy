import { palettes, resolveScheme } from '../theme';

describe('resolveScheme', () => {
  it('follows the system scheme when override is "system"', () => {
    expect(resolveScheme('dark', 'system')).toBe('dark');
    expect(resolveScheme('light', 'system')).toBe('light');
  });

  it('defaults to light when the system reports nothing', () => {
    expect(resolveScheme(null, 'system')).toBe('light');
    expect(resolveScheme(undefined, 'system')).toBe('light');
  });

  it('lets a manual override win over the system scheme', () => {
    expect(resolveScheme('dark', 'light')).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('dark');
  });
});

describe('palettes', () => {
  const tokens = ['bg', 'card', 'text', 'textMuted', 'accent', 'danger'] as const;

  it.each(['light', 'dark'] as const)('%s palette has every token', (scheme) => {
    for (const token of tokens) {
      expect(palettes[scheme][token]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
