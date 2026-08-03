const { decideRetry } = require('../worker/retryPolicy');

describe('retryPolicy.decideRetry', () => {
  const maxAttempts = 5;
  const baseDelayMs = 2000;

  test('first failure (retryCount 0) schedules a retry at the base delay', () => {
    const result = decideRetry({ retryCount: 0, maxAttempts, baseDelayMs });
    expect(result.action).toBe('RETRY');
    expect(result.nextRetryCount).toBe(1);
    expect(result.delayMs).toBe(2000); // base * 2^0
  });

  test('delay doubles on each successive attempt (exponential backoff)', () => {
    expect(decideRetry({ retryCount: 1, maxAttempts, baseDelayMs }).delayMs).toBe(4000);  // base * 2^1
    expect(decideRetry({ retryCount: 2, maxAttempts, baseDelayMs }).delayMs).toBe(8000);  // base * 2^2
    expect(decideRetry({ retryCount: 3, maxAttempts, baseDelayMs }).delayMs).toBe(16000); // base * 2^3
  });

  test('still retries on the final allowed attempt (retryCount == maxAttempts - 1)', () => {
    const result = decideRetry({ retryCount: maxAttempts - 1, maxAttempts, baseDelayMs });
    expect(result.action).toBe('RETRY');
    expect(result.nextRetryCount).toBe(maxAttempts);
  });

  test('dead-letters once retryCount reaches maxAttempts', () => {
    const result = decideRetry({ retryCount: maxAttempts, maxAttempts, baseDelayMs });
    expect(result.action).toBe('DEAD_LETTER');
    expect(result.delayMs).toBeUndefined();
  });

  test('dead-letters for any retryCount beyond maxAttempts too (defensive)', () => {
    const result = decideRetry({ retryCount: maxAttempts + 3, maxAttempts, baseDelayMs });
    expect(result.action).toBe('DEAD_LETTER');
  });

  test('a maxAttempts of 0 dead-letters immediately, never retries', () => {
    const result = decideRetry({ retryCount: 0, maxAttempts: 0, baseDelayMs });
    expect(result.action).toBe('DEAD_LETTER');
  });
});
