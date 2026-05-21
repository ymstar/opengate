import type { StringMatcher, ArgumentMatcher } from "./schema.js";

export function matchGlob(pattern: string, value: string): boolean {
  let pi = 0;
  let vi = 0;
  let starPi = -1;
  let starVi = -1;

  while (vi < value.length) {
    if (pi < pattern.length && (pattern[pi] === "?" || pattern[pi] === value[vi])) {
      pi++;
      vi++;
    } else if (pi < pattern.length && pattern[pi] === "*") {
      starPi = pi;
      starVi = vi;
      pi++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      starVi++;
      vi = starVi;
    } else {
      return false;
    }
  }

  while (pi < pattern.length && pattern[pi] === "*") {
    pi++;
  }

  return pi === pattern.length;
}

export function matchString(matcher: string | StringMatcher | undefined, value: string): boolean {
  if (matcher === undefined) return true;
  if (typeof matcher === "string") return matchGlob(matcher, value);

  if (matcher.glob !== undefined) return matchGlob(matcher.glob, value);
  if (matcher.regex !== undefined) return new RegExp(matcher.regex).test(value);
  if (matcher.equals !== undefined) return value === matcher.equals;
  return false;
}

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function matchArgument(matcher: ArgumentMatcher, value: unknown): boolean {
  if (typeof value !== "string") {
    if (typeof matcher === "string") return false;
    if ("equals" in matcher) return value === matcher.equals;
    if ("in" in matcher) return matcher.in.includes(String(value));
    return false;
  }

  if (typeof matcher === "string") return matchGlob(matcher, value);
  if ("startsWith" in matcher) return value.startsWith(matcher.startsWith);
  if ("endsWith" in matcher) return value.endsWith(matcher.endsWith);
  if ("contains" in matcher) return value.includes(matcher.contains);
  if ("regex" in matcher) return new RegExp(matcher.regex).test(value);
  if ("equals" in matcher) return value === matcher.equals;
  if ("in" in matcher) return matcher.in.includes(value);
  if ("not" in matcher) return !matchArgument(matcher.not, value);
  return false;
}

export function matchArguments(
  argMatchers: Record<string, ArgumentMatcher> | undefined,
  args: Record<string, unknown>,
): boolean {
  if (!argMatchers) return true;
  for (const [key, matcher] of Object.entries(argMatchers)) {
    const value = getNestedValue(args, key);
    if (!matchArgument(matcher, value)) return false;
  }
  return true;
}

export function matchAnnotations(
  annotationMatchers: Record<string, unknown> | undefined,
  annotations: Record<string, unknown> | undefined,
): boolean {
  if (!annotationMatchers) return true;
  if (!annotations) return false;
  for (const [key, expected] of Object.entries(annotationMatchers)) {
    if (annotations[key] !== expected) return false;
  }
  return true;
}
