/** Keep the existing deadline and fallback; release the losing watchdog. */
export async function beforeDeadline<T, F>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<F>(resolve => {
      timer = setTimeout(() => resolve(fallback), ms);
    })]);
  } finally { clearTimeout(timer); }
}
