export interface SafeErrorContext {
  errorName: string;
  errorCode?: string;
}

export function safeErrorContext(error: unknown): SafeErrorContext {
  if (typeof error !== 'object' || error === null) {
    return { errorName: 'UnknownError' };
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return {
    errorName:
      typeof candidate.name === 'string' &&
      /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(candidate.name)
        ? candidate.name
        : 'Error',
    ...(typeof candidate.code === 'string' &&
    /^[A-Z0-9_]{1,64}$/.test(candidate.code)
      ? { errorCode: candidate.code }
      : {}),
  };
}
