export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAt?: number,
  ) {
    super(message);
  }
}
