import { pushRecentlyViewed, resolveRecentlyViewed } from '@/lib/recently-viewed';

describe('pushRecentlyViewed', () => {
  it('puts the newest view first', () => {
    expect(pushRecentlyViewed(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('moves a re-opened recipe to the front without duplicating it', () => {
    expect(pushRecentlyViewed(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });

  it('caps the history', () => {
    expect(pushRecentlyViewed(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});

describe('resolveRecentlyViewed', () => {
  it('keeps view order and drops deleted recipes', () => {
    const recipes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(resolveRecentlyViewed(['c', 'gone', 'a'], recipes)).toEqual([
      { id: 'c' },
      { id: 'a' },
    ]);
  });
});
