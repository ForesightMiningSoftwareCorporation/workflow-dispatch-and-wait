import * as core from "@actions/core";

/**
 * Wait for a number of milliseconds.
 * @param milliseconds The number of milliseconds to wait.
 * @returns {Promise} Resolves after the wait is over.
 */
export const wait = (milliseconds: number): Promise<any> => {
  return new Promise((res) => setTimeout(res, milliseconds));
};


export const callWithRetry = async <T>(
    fn: () => Promise<T>,
    max_retry: number,
    retry_timeout: number,
    depth: number = 0
): Promise<T> => {
  try {
    const out: T = await fn();
    if (
        out === undefined ||
        out === null ||
        (Array.isArray(out) && out.length === 0)
    ) {
      await wait(retry_timeout);
      return callWithRetry(fn, max_retry, retry_timeout, depth + 1);
    }
    return out;
  } catch (e) {
    if (depth > max_retry) {
      throw e;
    }
    await wait(retry_timeout);
    return callWithRetry(fn, max_retry, retry_timeout, depth + 1);
  }
};