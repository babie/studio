export class InvalidParamsError extends Error {
  readonly _tag = "InvalidParamsError" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidParamsError";
  }
}

export const isInvalidParamsError = (err: unknown): err is InvalidParamsError =>
  err instanceof InvalidParamsError;
