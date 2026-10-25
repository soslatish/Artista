import { standsOnSurface } from '@/lib/try-on';

describe('standsOnSurface', () => {
  it('puts sculpture and ceramics on a table', () => {
    expect(standsOnSurface({ category: 'sculpture', technique: 'wood' })).toBe(true);
    expect(standsOnSurface({ category: 'mixed', technique: 'ceramics' })).toBe(true);
    expect(standsOnSurface({ category: 'mixed', technique: 'bronze' })).toBe(true);
  });

  it('hangs paintings, graphics and photos on the wall', () => {
    expect(standsOnSurface({ category: 'painting', technique: 'oil' })).toBe(false);
    expect(standsOnSurface({ category: 'photo', technique: 'photo_print' })).toBe(false);
  });
});
