import { safeErrorContext } from './safe-log-context';

describe('safeErrorContext', () => {
  it('keeps allowlisted diagnostics without secrets, signed URLs or stderr', () => {
    const error = Object.assign(
      new Error(
        'secret=super-secret https://storage/object?X-Amz-Signature=token stderr payload',
      ),
      {
        code: 'STORAGE_UNAVAILABLE',
        name: 'token=malicious-name',
        stderr: 'password=credential',
        token: 'bearer-token',
      },
    );
    const serialized = JSON.stringify(safeErrorContext(error));

    expect(serialized).toContain('STORAGE_UNAVAILABLE');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('X-Amz');
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('bearer-token');
    expect(serialized).toContain('"errorName":"Error"');
  });

  it('drops unbounded or unsafe error codes', () => {
    expect(
      safeErrorContext({ name: 'Synthetic', code: 'token=value' }),
    ).toEqual({ errorName: 'Synthetic' });
  });
});
