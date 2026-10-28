/** An error that maps to an HTTP status and a client-safe message. */
export class HttpError extends Error {
  /**
   * @param status - HTTP status code
   * @param code - Stable machine-readable code
   * @param message - Client-safe message
   */
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
