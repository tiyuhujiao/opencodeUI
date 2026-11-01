import type { QuestionInfo } from './protocol';

// OpenCode v2.1.4: packages/schema/src/form.ts and core/src/form.ts.
export type V2FormValue = string | number | boolean | string[];
export type V2FormAnswer = Record<string, V2FormValue>;
export type V2FormDraft = Record<string, V2FormValue | undefined>;
export type V2FormWhen = { key: string; op: 'eq' | 'neq'; value: string | number | boolean };
export type V2FormOption = { value: string; label: string; description?: string };
type InputBase = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: V2FormWhen[];
};
export type V2FormField =
  | (InputBase & {
      type: 'string'; default?: string; placeholder?: string;
      format?: 'email' | 'uri' | 'date' | 'date-time';
      minLength?: number; maxLength?: number; pattern?: string;
      options?: V2FormOption[]; custom?: boolean;
    })
  | (InputBase & { type: 'number' | 'integer'; default?: number; minimum?: number; maximum?: number })
  | (InputBase & { type: 'boolean'; default?: boolean })
  | (InputBase & {
      type: 'multiselect'; options: V2FormOption[]; default?: string[];
      custom?: boolean; minItems?: number; maxItems?: number;
    })
  | { type: 'external'; key: string; title?: string; description?: string; url: string };
export type V2FormInfo = {
  id: string;
  sessionID: string;
  title: string;
  fields: V2FormField[];
  metadata?: Record<string, unknown>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isV2FormAnswer(value: unknown): value is V2FormAnswer {
  return record(value) && Object.values(value).every((item) =>
    typeof item === 'string' || typeof item === 'boolean' ||
    (typeof item === 'number' && Number.isFinite(item)) ||
    (Array.isArray(item) && item.every((entry) => typeof entry === 'string'))
  );
}

export function isV2FormFields(value: unknown): value is V2FormField[] {
  return Array.isArray(value) && value.every(isV2FormField) &&
    new Set(value.map((field) => field.key)).size === value.length;
}

function isV2FormField(value: unknown): value is V2FormField {
  if (!record(value) || typeof value.key !== 'string') return false;
  if (value.title !== undefined && typeof value.title !== 'string') return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.type === 'external') return typeof value.url === 'string';
  for (const key of ['required', 'hidden', 'custom']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') return false;
  }
  if (value.when !== undefined && (!Array.isArray(value.when) || !value.when.every((when) =>
    record(when) && typeof when.key === 'string' && (when.op === 'eq' || when.op === 'neq') &&
    (typeof when.value === 'string' || typeof when.value === 'boolean' ||
      (typeof when.value === 'number' && Number.isFinite(when.value)))
  ))) return false;
  if (value.options !== undefined && (!Array.isArray(value.options) || !value.options.every((option) =>
    record(option) && typeof option.value === 'string' && typeof option.label === 'string' &&
    (option.description === undefined || typeof option.description === 'string')
  ))) return false;
  if (value.type === 'string') {
    return ['default', 'placeholder', 'pattern'].every((key) => value[key] === undefined || typeof value[key] === 'string') &&
      (value.format === undefined || ['email', 'uri', 'date', 'date-time'].includes(String(value.format))) &&
      ['minLength', 'maxLength'].every((key) => value[key] === undefined || nonNegativeInteger(value[key]));
  }
  if (value.type === 'number' || value.type === 'integer') {
    return ['default', 'minimum', 'maximum'].every((key) => value[key] === undefined ||
      (typeof value[key] === 'number' && Number.isFinite(value[key])));
  }
  if (value.type === 'boolean') return value.default === undefined || typeof value.default === 'boolean';
  if (value.type === 'multiselect') {
    return Array.isArray(value.options) &&
      (value.default === undefined || (Array.isArray(value.default) && value.default.every((item) => typeof item === 'string'))) &&
      ['minItems', 'maxItems'].every((key) => value[key] === undefined || nonNegativeInteger(value[key]));
  }
  return false;
}

function nonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function parseV2Form(value: unknown): V2FormInfo | undefined {
  if (!record(value) || typeof value.id !== 'string' || typeof value.sessionID !== 'string' ||
    !isV2FormFields(value.fields) || value.fields.length === 0) return undefined;
  return {
    id: value.id, sessionID: value.sessionID,
    title: typeof value.title === 'string' ? value.title : value.id,
    fields: value.fields,
    ...(record(value.metadata) ? { metadata: value.metadata } : {})
  };
}

export function isV2FormActive(field: V2FormField, answer: V2FormAnswer): boolean {
  if (field.type === 'external') return true;
  return (field.when ?? []).every((when) => {
    const value = answer[when.key];
    if (value === undefined) return false;
    const hit = Array.isArray(value) ? value.some((item) => item === when.value) : value === when.value;
    return when.op === 'eq' ? hit : !hit;
  });
}

/** Apply client defaults in field order, omitting inactive and explicitly skipped values. */
export function buildV2FormAnswer(fields: readonly V2FormField[], draft: V2FormDraft): V2FormAnswer {
  const answer: V2FormAnswer = {};
  for (const field of fields) {
    if (!isV2FormActive(field, answer)) continue;
    const value = Object.prototype.hasOwnProperty.call(draft, field.key)
      ? draft[field.key] : field.type === 'external' ? undefined : field.default;
    if (value !== undefined) answer[field.key] = Array.isArray(value) ? [...value] : value;
  }
  return answer;
}

export function validateV2FormAnswer(fields: readonly V2FormField[], answer: V2FormAnswer): Record<string, string> {
  const errors: Record<string, string> = {};
  const keys = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(answer)) if (!keys.has(key)) errors[key] = `Unknown form field: ${key}`;
  for (const field of fields) {
    const value = answer[field.key];
    const label = field.title || field.key;
    if (field.type === 'external') {
      if (value !== true) errors[field.key] = `External form field must be acknowledged: ${label}`;
      continue;
    }
    if (value === undefined) {
      if (field.required && isV2FormActive(field, answer)) errors[field.key] = `Missing required form field: ${label}`;
      continue;
    }
    if (!isV2FormActive(field, answer)) {
      errors[field.key] = `Form field is not active: ${label}`;
      continue;
    }
    const error = validateField(field, value, label);
    if (error) errors[field.key] = error;
  }
  return errors;
}

function validateField(field: Exclude<V2FormField, { type: 'external' }>, value: V2FormValue, label: string): string | undefined {
  if (field.type === 'string') {
    if (typeof value !== 'string') return `Expected string for form field: ${label}`;
    if (field.required && value.length === 0) return `Missing required form field: ${label}`;
    if (field.minLength !== undefined && value.length < field.minLength) return `Form field is too short: ${label}`;
    if (field.maxLength !== undefined && value.length > field.maxLength) return `Form field is too long: ${label}`;
    if (field.pattern !== undefined) {
      try { if (!new RegExp(field.pattern).test(value)) return `Form field does not match pattern: ${label}`; }
      catch { return `Form field has invalid pattern: ${label}`; }
    }
    if (field.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `Expected email for form field: ${label}`;
    if (field.format === 'uri') {
      try { new URL(value); } catch { return `Expected URI for form field: ${label}`; }
    }
    if (field.format === 'date' && !validDate(value)) return `Expected date for form field: ${label}`;
    if (field.format === 'date-time' && Number.isNaN(new Date(value).getTime())) return `Expected date-time for form field: ${label}`;
    if (field.options && !field.custom && !field.options.some((option) => option.value === value)) return `Invalid option for form field: ${label}`;
  } else if (field.type === 'number' || field.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `Expected number for form field: ${label}`;
    if (field.type === 'integer' && !Number.isInteger(value)) return `Expected integer for form field: ${label}`;
    if (field.minimum !== undefined && value < field.minimum) return `Form field is too small: ${label}`;
    if (field.maximum !== undefined && value > field.maximum) return `Form field is too large: ${label}`;
  } else if (field.type === 'boolean') {
    if (typeof value !== 'boolean') return `Expected boolean for form field: ${label}`;
  } else if (field.type === 'multiselect') {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return `Expected string array for form field: ${label}`;
    if (field.required && value.length === 0) return `Missing required form field: ${label}`;
    if (field.minItems !== undefined && value.length < field.minItems) return `Too few selections for form field: ${label}`;
    if (field.maxItems !== undefined && value.length > field.maxItems) return `Too many selections for form field: ${label}`;
    if (!field.custom && value.some((item) => !field.options.some((option) => option.value === item))) return `Invalid option for form field: ${label}`;
  }
  return undefined;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The legacy question view is used only by the compatibility request path. */
export function v2LegacyQuestions(form: V2FormInfo): QuestionInfo[] {
  return form.fields.flatMap((field): QuestionInfo[] => {
    if (field.type === 'external' || field.type === 'boolean' || field.hidden) return [];
    const header = field.title || field.key;
    const options = field.type === 'string' || field.type === 'multiselect' ? field.options : undefined;
    return [{
      header, question: field.description || header,
      options: (options ?? []).map((option) => ({ label: option.label, description: option.description || option.label })),
      multiple: field.type === 'multiselect', custom: options === undefined || ('custom' in field && field.custom === true)
    }];
  });
}

export function v2LegacyAnswer(form: V2FormInfo, answers: unknown): V2FormAnswer {
  const draft: V2FormDraft = {};
  let index = 0;
  for (const field of form.fields) {
    if (field.type === 'external' || field.type === 'boolean' || field.hidden) continue;
    const raw = Array.isArray(answers) ? answers[index] : undefined;
    index += 1;
    if (!Array.isArray(raw)) continue;
    const options = field.type === 'string' || field.type === 'multiselect' ? field.options : undefined;
    const values = raw.filter((value): value is string => typeof value === 'string').map((value) =>
      options?.find((option) => option.label === value)?.value ?? value
    );
    if (field.type === 'multiselect') draft[field.key] = values;
    else if (field.type === 'integer' || field.type === 'number') {
      draft[field.key] = values[0]?.trim() ? Number(values[0]) : undefined;
    } else draft[field.key] = values[0];
  }
  return buildV2FormAnswer(form.fields, draft);
}
