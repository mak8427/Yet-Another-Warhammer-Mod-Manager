export function gridColumns(showAuthors: boolean, showThumbnails: boolean): string {
  return [
    '18px',
    '26px',
    showThumbnails ? '30px' : null,
    'minmax(0, 1fr)',
    showAuthors ? '150px' : null,
    '150px',
    '70px',
    '92px',
  ]
    .filter(Boolean)
    .join(' ')
}
