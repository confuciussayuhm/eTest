/**
 * Functional Programming Utilities
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PipelineFunction = (x: any) => any | Promise<any>;

export async function asyncPipe<TResult>(
  initial: unknown,
  ...fns: PipelineFunction[]
): Promise<TResult> {
  let result = initial;
  for (const fn of fns) {
    result = await fn(result);
  }
  return result as TResult;
}
