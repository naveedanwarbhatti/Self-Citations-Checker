import { test, expect } from '@playwright/test';
import { fetchSelfCitationStats } from '../src/dblpSelfCitation';

test('fetchSelfCitationStats returns numeric values', async () => {
  const stats = await fetchSelfCitationStats('00/1');
  expect(typeof stats.total).toBe('number');
  expect(typeof stats.self).toBe('number');
  expect(typeof stats.rate).toBe('number');
  expect(stats.rate).toBeGreaterThanOrEqual(0);
  expect(stats.rate).toBeLessThanOrEqual(1);
});
