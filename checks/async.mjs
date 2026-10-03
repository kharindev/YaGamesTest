// Bound individual external operations, not entire state transitions: a timed-out
// transition must never continue mutating test state in the background.
export async function withDeadline(operation, label, timeoutMs = 4000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: превышено ожидание (${timeoutMs} мс)`)), timeoutMs);
      })
    ]);
  } finally { clearTimeout(timer); }
}

export function boundedMethods(target, methods, label, timeoutMs) {
  return Object.fromEntries(methods.map((method) => [method, (...args) =>
    withDeadline(() => target[method](...args), `${label}.${method}`, timeoutMs)]));
}
