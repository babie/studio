/**
 * Exhaustiveness check for discriminated unions. Calling this should be
 * unreachable at runtime; if it is reached, the union has a case the caller
 * did not handle.
 */
export const assertNever = (value: never): never => {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`);
};
