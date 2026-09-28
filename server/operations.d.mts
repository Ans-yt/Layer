export interface OperationIssue { index: number; message: string; field?: string }
export interface OperationValidation { ok: boolean; operations: unknown[]; errors: OperationIssue[] }
export function validateOperations(document: unknown, operations: unknown, scope: unknown): OperationValidation
export function applyOperations<T>(document: T, operations: unknown, scope: unknown): { document: T; project: T; operations: unknown[]; errors: OperationIssue[] }
export class OperationValidationError extends Error { errors: OperationIssue[] }
export function materializeElement(input: unknown): Record<string, unknown>
export function parseOperations(value: unknown): unknown[]
export const ELEMENT_TYPES: Set<string>
export const OPERATION_NAMES: Set<string>
export const ALLOWED_PATCH_FIELDS: Set<string>
