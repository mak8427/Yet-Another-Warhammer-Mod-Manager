import type { Density } from '../../lib/ipc'

export interface GridOptions {
  density: Density
  showAuthors: boolean
  showThumbnails: boolean
  width: number
}

export function showTagsColumn(width: number): boolean {
  return width >= 1100
}

export function showAuthorColumn(options: GridOptions): boolean {
  return options.showAuthors && options.density !== 'compact' && options.width >= 1440
}

/** One template shared by the header and every row at the same breakpoint. */
export function gridColumns(options: GridOptions): string {
  const parts: string[] = ['var(--row-order-w)', 'var(--row-check-w)']
  if (options.showThumbnails) parts.push('var(--row-thumb)')
  parts.push('minmax(180px, 1fr)')
  if (showTagsColumn(options.width)) parts.push('var(--row-tags-w)')
  if (showAuthorColumn(options)) parts.push('var(--row-author-w)')
  parts.push('var(--row-status-w)', 'var(--row-menu-w)')
  return parts.join(' ')
}
