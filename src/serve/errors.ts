import { ConfigError } from '../cli/config';
import { AUTH_FAILED_HINT } from '../cli/errors';
import type { ServeError } from '../interfaces/Serve';
import { ProtocolError } from './protocol';

/** Socket error codes that mean Azure DevOps could not be reached at all. */
const OFFLINE_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ConnectionRefused',
  'ConnectionClosed',
  'FailedToOpenSocket',
];

/** "This work item has been changed by someone else since you opened it" — a failed `test /rev`. */
const REVISION_CONFLICT = /TF26071/;

const INVALID_STATE = /TF401320|^State ".*" is not valid for /;

interface UpstreamError {
  statusCode?: number;
  code?: string;
  message?: string;
}

function withHint(error: ServeError, hint?: string): ServeError {
  return hint ? { ...error, hint } : error;
}

/** Any failure → the `{kind, message, hint}` a client shows instead of a stack trace. */
export function toServeError(err: unknown): ServeError {
  if (err instanceof ProtocolError) {
    return { ...withHint({ kind: err.kind, message: err.message }, err.hint), ...(err.details ? { details: err.details } : {}) };
  }
  if (err instanceof ConfigError) return withHint({ kind: err.kind, message: err.message }, err.hint);

  const e = (err ?? {}) as UpstreamError;
  const message = e.message ?? String(err);
  const status = e.statusCode;

  // The API's rule error for a state the type does not allow from here, or WorkItemService's explanation of it.
  if (INVALID_STATE.test(message)) return { kind: 'invalid_state', message };
  if (status === 401) return { kind: 'needs_login', message, hint: AUTH_FAILED_HINT.join('\n') };
  if (status === 403) return { kind: 'forbidden', message };
  if (status === 404) return { kind: 'not_found', message };
  if (status === 409 || status === 412 || REVISION_CONFLICT.test(message)) return { kind: 'conflict', message };
  if (status === 429) return { kind: 'rate_limited', message };
  if (status !== undefined && status >= 500) return { kind: 'upstream', message };
  if (e.code && OFFLINE_CODES.includes(e.code)) return { kind: 'offline', message };
  return { kind: 'internal', message };
}
