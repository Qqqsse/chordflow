import type { z } from 'zod';

/** Stable, language-neutral validation issue codes shared by TS and Python consumers. */
export const VALIDATION_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'UNSUPPORTED_SCHEMA_VERSION',
  'DUPLICATE_ID',
  'ANCHOR_OUT_OF_BOUNDS',
  'TEXT_NOT_NFC',
  'INVALID_TEXT_CHARACTER',
  'UNKNOWN_REFERENCE',
  'INTERVAL_INVALID',
  'INTERVAL_OUT_OF_RANGE',
  'NOT_MONOTONIC',
  'GRAPHEME_RANGE_INVALID',
  'REFERENCE_MISMATCH',
] as const;

export type ValidationIssueCode = (typeof VALIDATION_ISSUE_CODES)[number];

export type IssuePath = (string | number)[];

export interface ValidationIssue {
  code: ValidationIssueCode;
  path: IssuePath;
  message: string;
}

export type ValidationResult<T> =
  { ok: true; value: T; issues: [] } | { ok: false; value: null; issues: ValidationIssue[] };

export function success<T>(value: T): ValidationResult<T> {
  return { ok: true, value, issues: [] };
}

export function failure<T>(issues: ValidationIssue[]): ValidationResult<T> {
  return { ok: false, value: null, issues };
}

export function fromZodError(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: 'SCHEMA_INVALID',
    path: issue.path.map((segment) => (typeof segment === 'number' ? segment : String(segment))),
    message: issue.message,
  }));
}

export class ContractValidationError extends Error {
  override name = 'ContractValidationError';
  readonly issues: readonly ValidationIssue[];

  constructor(what: string, issues: readonly ValidationIssue[]) {
    const first = issues[0];
    super(
      first
        ? `${what} is invalid: ${first.code} at ${first.path.join('.') || '(root)'}: ${first.message}`
        : `${what} is invalid`,
    );
    this.issues = issues;
  }
}
