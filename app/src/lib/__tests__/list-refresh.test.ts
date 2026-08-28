import { consumeInvalidation, invalidateLists } from '@/lib/list-refresh';

describe('list invalidation', () => {
  it('marks lists dirty and consumes each exactly once', () => {
    invalidateLists('library', 'groceries');

    expect(consumeInvalidation('library')).toBe(true);
    expect(consumeInvalidation('library')).toBe(false);
    expect(consumeInvalidation('plan')).toBe(false);
    expect(consumeInvalidation('groceries')).toBe(true);
  });
});
