import styles from './LayerToggle.module.css'

interface LayerToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}

/**
 * Visibility switch for one visualization layer. Keeps the panel's existing
 * chip shape, with a state dot so on/off reads at a glance rather than from
 * colour alone.
 */
export function LayerToggle({ label, checked, onChange, hint }: LayerToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      className={`${styles.chip} ${checked ? styles.chipOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </button>
  )
}
