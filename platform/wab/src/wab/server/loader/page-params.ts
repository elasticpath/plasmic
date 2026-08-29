/**
 * Page params parsing module for HTML loader.
 *
 * Provides parsing and validation for dynamic route parameters
 * (pageRoute, pageParams, pageQuery) used in server-side rendering.
 */

import { BadRequestError } from "@/wab/shared/ApiErrors/errors";

// --- Types ---

export type PageParamsValue = string | string[];
export type PageParams = Record<string, PageParamsValue>;

// --- Pure validation functions ---

export const isValidRoutePattern = (route: string): boolean => {
  return typeof route === "string" && route.startsWith("/");
};

export const isValidParamValue = (value: unknown): value is PageParamsValue => {
  if (typeof value === "string") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === "string");
  }
  return false;
};

export const isValidParamsObject = (obj: unknown): obj is PageParams => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return false;
  }
  return Object.values(obj).every(isValidParamValue);
};

export const getInvalidParamKeys = (obj: Record<string, unknown>): string[] => {
  return Object.entries(obj)
    .filter(([_, value]) => !isValidParamValue(value))
    .map(([key]) => key);
};

// --- Parsing helpers ---

const isEmptyInput = (value: unknown): boolean => {
  return value === undefined || value === null || value === "";
};

const parseJsonObject = (
  raw: unknown,
  fieldName: string
): Record<string, unknown> => {
  if (typeof raw !== "string") {
    throw new BadRequestError(`${fieldName} must be a JSON string`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError(`${fieldName} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadRequestError(`${fieldName} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

const validateParamValues = (
  obj: Record<string, unknown>,
  fieldName: string
): PageParams => {
  const invalidKeys = getInvalidParamKeys(obj);
  if (invalidKeys.length > 0) {
    throw new BadRequestError(
      `${fieldName} contains invalid values for keys: ${invalidKeys.join(", ")}`
    );
  }
  return obj as PageParams;
};

// --- Public parse functions ---

export const parsePageRoute = (rawPageRoute?: unknown): string | undefined => {
  if (isEmptyInput(rawPageRoute)) {
    return undefined;
  }
  if (typeof rawPageRoute !== "string") {
    throw new BadRequestError("pageRoute must be a string");
  }
  if (!isValidRoutePattern(rawPageRoute)) {
    throw new BadRequestError("pageRoute must start with /");
  }
  return rawPageRoute;
};

export const parsePageParams = (
  rawPageParams?: unknown
): PageParams | undefined => {
  if (isEmptyInput(rawPageParams)) {
    return undefined;
  }
  const parsed = parseJsonObject(rawPageParams, "pageParams");
  return validateParamValues(parsed, "pageParams");
};

export const parsePageQuery = (
  rawPageQuery?: unknown
): PageParams | undefined => {
  if (isEmptyInput(rawPageQuery)) {
    return undefined;
  }
  const parsed = parseJsonObject(rawPageQuery, "pageQuery");
  return validateParamValues(parsed, "pageQuery");
};
