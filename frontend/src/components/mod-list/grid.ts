export interface GridOptions {
  showThumbnails: boolean
  width: number
}

export function showTagsColumn(width: number): boolean {
  return width >= 1100
}

/** One template shared by the header and every row at the same breakpoint. */
export function gridColumns(options: GridOptions): string {
  const parts: string[] = ['var(--row-order-w)', 'var(--row-check-w)']
  if (options.showThumbnails) parts.push('var(--row-thumb)')
  parts.push('minmax(180px, 1fr)')
  if (showTagsColumn(options.width)) parts.push('var(--row-tags-w)')
  parts.push('var(--row-status-w)', 'var(--row-menu-w)')
  return parts.join(' ')
}
