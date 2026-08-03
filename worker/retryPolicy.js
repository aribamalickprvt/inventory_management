/**
 * Pure function, no I/O — deliberately kept separate from worker.js so it
 * can be unit tested without RabbitMQ, MySQL, or any network at all.
 *
 * Given how many times a message has already been retried, decide whether
 * to retry again (with how much delay) or give up and dead-letter it.
 */
function decideRetry({ retryCount, maxAttempts, baseDelayMs }) {
  if (retryCount >= maxAttempts) {
    return { action: 'DEAD_LETTER' };
  }
  const delayMs = baseDelayMs * 2 ** retryCount; // exponential backoff: base, 2x, 4x, 8x, ...
  return { action: 'RETRY', nextRetryCount: retryCount + 1, delayMs };
}

module.exports = { decideRetry };
