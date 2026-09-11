import type { ReactNode } from 'react'
import styles from './Panel.module.css'

interface PanelProps {
  title: string
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Reusable floating glass panel. Header row (eyebrow + title + optional
 * actions) stays fixed; the body scrolls independently.
 */
export function Panel({ title, eyebrow, actions, children, className }: PanelProps) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`}>
      <div className={styles.head}>
        <div className={styles.heading}>
          {eyebrow ? <span className="ov-eyebrow">{eyebrow}</span> : null}
          <h2 className={styles.title}>{title}</h2>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      <div className={`${styles.body} ov-scroll`}>{children}</div>
    </section>
  )
}
