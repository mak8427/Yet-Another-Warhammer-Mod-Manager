import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  children: ReactNode
  action?: ReactNode
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{children}</span>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
