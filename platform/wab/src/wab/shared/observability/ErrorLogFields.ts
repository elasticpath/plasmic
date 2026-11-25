export type ErrorLogFields = Record<string, string>;

type ErrorWithLogFields = Error & { logFields?: unknown };

export function addErrorLogFields(err: Error, fields: ErrorLogFields) {
  (err as ErrorWithLogFields).logFields = {
    ...getErrorLogFields(err),
    ...fields,
  };
}

export function getErrorLogFields(err: Error): ErrorLogFields | undefined {
  const fields = (err as ErrorWithLogFields).logFields;
  return typeof fields === "object" && fields !== null
    ? (fields as ErrorLogFields)
    : undefined;
}
