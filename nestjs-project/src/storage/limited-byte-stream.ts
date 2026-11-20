import { Transform, type TransformCallback } from 'node:stream';

export class LimitedByteStream extends Transform {
  private bytes = 0;

  constructor(private readonly maximumBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maximumBytes) {
      callback(new Error('Stream exceeded configured byte limit'));
      return;
    }
    callback(null, chunk);
  }
}
