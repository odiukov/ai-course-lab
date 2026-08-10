let tail: Promise<unknown> = Promise.resolve();
let depth = 0;

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  depth += 1;
  const result = tail.then(task);
  tail = result.catch(() => undefined).finally(() => {
    depth -= 1;
  });
  return result;
}

export function queueDepth(): number {
  return depth;
}
