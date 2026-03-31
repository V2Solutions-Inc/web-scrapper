export interface RetryContext {
  attempt: number;
  proxy?: string;
}

export function getRetryStrategy(attempt: number) {
  return {
    useNewContext: attempt >= 1,
    // useNewProxy: attempt >= 2,
    useNewBrowser: attempt >= 2,
    addDelay: attempt >= 2
  };
}
