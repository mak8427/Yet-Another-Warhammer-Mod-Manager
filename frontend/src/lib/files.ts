import { downloadDir, join } from '@tauri-apps/api/path'
import { IpcError } from './ipc'

/**
 * The two file pickers the profile share flow needs.
 *
 * Kept behind an interface so store tests can drive import/export without a
 * desktop dialog, and so the dialog plugin stays the only thing that knows how
 * a path is chosen.
 */
export interface ProfileFiles {
  chooseExportPath(suggestedName: string): Promise<string | null>
  chooseImportPath(): Promise<string | null>
}

const PROFILE_FILTER = { name: 'Profile JSON', extensions: ['json'] }

/** `Campaign` becomes `Campaign.wh3mm-profile.json`, safe on every desktop. */
export function suggestedProfileFileName(profileName: string): string {
  const printable = Array.from(profileName.trim())
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
  const slug = printable
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 60)
  return `${slug || 'profile'}.wh3mm-profile.json`
}

function dialogFailure(cause: unknown): IpcError {
  if (cause instanceof IpcError) return cause
  return new IpcError({
    code: 'internal',
    message: 'Could not open the file dialog; profile import and export need the desktop app',
    details: cause instanceof Error ? cause.message : null,
    retryable: false,
  })
}

async function defaultExportPath(fileName: string): Promise<string> {
  try {
    return await join(await downloadDir(), fileName)
  } catch {
    return fileName
  }
}

/** Native save/open dialogs. Paths are produced here; all file IO is in Rust. */
export const profileFiles: ProfileFiles = {
  async chooseExportPath(suggestedName) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const path = await save({
        title: 'Export profile',
        defaultPath: await defaultExportPath(suggestedName),
        filters: [PROFILE_FILTER],
      })
      return path ?? null
    } catch (cause) {
      throw dialogFailure(cause)
    }
  },

  async chooseImportPath() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const path = await open({
        title: 'Import profile',
        multiple: false,
        directory: false,
        filters: [PROFILE_FILTER],
      })
      return typeof path === 'string' ? path : null
    } catch (cause) {
      throw dialogFailure(cause)
    }
  },
}
