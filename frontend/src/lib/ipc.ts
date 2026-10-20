import { invoke } from '@tauri-apps/api/core'

/**
 * Manual mirror of the Rust IPC contract.
 *
 * Source of truth:
 * - `crates/wh3mm-core/src/ipc.rs` (payload structs)
 * - `crates/wh3mm-core/src/error.rs` (error envelope and codes)
 * - ADR-002 in `docs/adr/002-ipc-contract.md`
 *
 * Keep this file in lockstep with Rust. Do not add filesystem or business
 * logic here; this module only marshals values across the Tauri boundary.
 */

export const ERROR_CODES = [
  'io',
  'config_corrupt',
  'game_not_found',
  'steam_not_found',
  'pack_parse_failed',
  'not_found',
  'validation',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** Wire shape of `wh3mm_core::error::AppError`. */
export interface AppErrorPayload {
  code: ErrorCode
  message: string
  details: string | null
  retryable: boolean
}

/** Wire shape of `wh3mm_core::ipc::AppInfo`. */
export interface AppInfo {
  name: string
  version: string
  coreVersion: string
  platform: string
  arch: string
}

export type CommandName = 'app_info'

export async function appInfo(): Promise<AppInfo> {
  return invokeCommand<AppInfo>('app_info')
}

/** Normalized rejection thrown by every command wrapper. */
export class IpcError extends Error {
  readonly code: ErrorCode
  readonly details: string | null
  readonly retryable: boolean

  constructor(payload: AppErrorPayload) {
    super(payload.message)
    this.name = 'IpcError'
    this.code = payload.code
    this.details = payload.details
    this.retryable = payload.retryable
  }
}

function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value)
}

function isErrorPayload(value: unknown): value is AppErrorPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.code === 'string' &&
    isErrorCode(candidate.code) &&
    typeof candidate.message === 'string' &&
    (candidate.details === null || typeof candidate.details === 'string') &&
    typeof candidate.retryable === 'boolean'
  )
}

/**
 * Converts anything Tauri may reject with into a stable `IpcError`.
 * Tauri rejects with the serialized `AppError`; panics and bridge failures can
 * surface as strings or `Error` instances instead.
 */
export function toIpcError(cause: unknown): IpcError {
  if (cause instanceof IpcError) return cause
  if (isErrorPayload(cause)) return new IpcError(cause)
  if (cause instanceof Error) {
    return new IpcError({
      code: 'internal',
      message: cause.message,
      details: null,
      retryable: false,
    })
  }
  return new IpcError({
    code: 'internal',
    message: typeof cause === 'string' ? cause : 'Unknown IPC failure',
    details: null,
    retryable: false,
  })
}

export async function invokeCommand<T>(
  command: CommandName,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (cause) {
    throw toIpcError(cause)
  }
}

/** Typed facade used by components; one method per registered Rust command. */
export const ipc = {
  appInfo,
}
