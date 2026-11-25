export function withCodegenErrorContext<T>(
  projectId: string,
  component: { name: string; uuid: string },
  fn: () => T
): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof Error) {
      err.message = `Codegen failed for component "${component.name}" (${component.uuid}) in project ${projectId}: ${err.message}`;
    }
    throw err;
  }
}
