import { useCallback, useId, useMemo, useState, type KeyboardEvent } from 'react'
import {
  parseCoordinates,
  regionForPoint,
  resolveSearch,
  searchRegions,
} from '../../data/locationSearch'
import { formatGeoPoint, type OceanRegion } from '../../state/locationState'
import { AvailabilityBadge } from './AvailabilityBadge'
import styles from './LocationSearch.module.css'

const MAX_SUGGESTIONS = 6

interface Suggestion {
  key: string
  region: OceanRegion
  /** Primary line — what was matched. */
  label: string
  /** Secondary line — why it matched, or what kind of place it is. */
  detail: string
}

interface LocationSearchProps {
  onSelect: (region: OceanRegion) => void
}

/**
 * Finding an ocean area by typing.
 *
 * One field covers every way a reader might name a place — the sea itself, the
 * basin it belongs to, a coastal country, or a coordinate pair — because
 * asking them to pick the right kind of search first is a question the
 * application can answer for itself: a query built only from numbers and
 * hemisphere letters is a position, and anything else is a name.
 *
 * Nothing leaves the browser. Both paths resolve against the local demo
 * catalogue through `resolveSearch`, which is the single seam a real gazetteer
 * replaces later.
 */
export function LocationSearch({ onSelect }: LocationSearchProps) {
  const listId = useId()
  const optionId = (index: number) => `${listId}-option-${index}`

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [error, setError] = useState<string | null>(null)

  /**
   * Suggestions, and the guidance shown when there are none.
   *
   * A coordinate query resolves to exactly one place, so it offers one row
   * naming the region it lands in — which is how a reader finds out that
   * `12.94, 74.86` is the Arabian Sea rather than having to already know.
   */
  const { suggestions, hint } = useMemo<{
    suggestions: Suggestion[]
    hint: string | null
  }>(() => {
    const text = query.trim()
    if (text === '') return { suggestions: [], hint: null }

    const coordinates = parseCoordinates(text)

    // Reported as guidance rather than as an error: the reader is very likely
    // still mid-way through typing the pair.
    if (coordinates.status === 'invalid') {
      return { suggestions: [], hint: coordinates.message }
    }

    if (coordinates.status === 'point') {
      const region = regionForPoint(coordinates.point)
      return {
        suggestions: [
          {
            key: 'coordinates',
            region,
            label: formatGeoPoint(coordinates.point),
            detail:
              region.kind === 'coordinates'
                ? 'Outside the demo regions'
                : `In the ${region.name}`,
          },
        ],
        hint: null,
      }
    }

    const matches = searchRegions(text).slice(0, MAX_SUGGESTIONS)
    return {
      suggestions: matches.map((region) => ({
        key: region.id,
        region,
        label: region.name,
        detail: region.note,
      })),
      hint:
        matches.length === 0
          ? 'No region matches. Try an ocean, a sea, a coastal country, or coordinates.'
          : null,
    }
  }, [query])

  const expanded = open && (suggestions.length > 0 || hint !== null)

  const commit = useCallback(
    (region: OceanRegion) => {
      onSelect(region)
      setQuery('')
      setOpen(false)
      setHighlight(-1)
      setError(null)
    },
    [onSelect],
  )

  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault()

    const chosen = suggestions[highlight]
    if (chosen !== undefined) {
      commit(chosen.region)
      return
    }

    const outcome = resolveSearch(query)
    if (outcome.status === 'region') {
      commit(outcome.region)
      return
    }
    if (outcome.status === 'error') {
      setError(outcome.message)
      setOpen(false)
    }
  }

  const move = (step: number) => {
    if (suggestions.length === 0) return
    setOpen(true)
    setHighlight((current) => {
      const next = current + step
      if (next < 0) return suggestions.length - 1
      if (next >= suggestions.length) return 0
      return next
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === 'Escape') {
      if (expanded) {
        setOpen(false)
        setHighlight(-1)
      } else {
        setQuery('')
        setError(null)
      }
    }
  }

  return (
    <div className={styles.search}>
      <form className={styles.field} role="search" onSubmit={handleSubmit}>
        <span className={styles.icon} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <circle cx="10.5" cy="10.5" r="6.2" />
            <path d="m15.2 15.2 4 4" />
          </svg>
        </span>

        <input
          className={styles.input}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search ocean region or coordinates…"
          aria-label="Search for an ocean region by name, coastal area, or coordinates"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            highlight >= 0 && expanded ? optionId(highlight) : undefined
          }
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setHighlight(-1)
            setError(null)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        />

        {query !== '' ? (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear search"
            // Keeps focus in the field, so the dropdown does not close under
            // the pointer before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery('')
              setError(null)
              setHighlight(-1)
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        ) : null}
      </form>

      {expanded ? (
        <div className={styles.popover}>
          <ul className={styles.list} id={listId} role="listbox" aria-label="Region suggestions">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.key}
                id={optionId(index)}
                role="option"
                aria-selected={index === highlight}
                className={`${styles.option} ${index === highlight ? styles.optionOn : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => commit(suggestion.region)}
              >
                <span className={styles.name}>{suggestion.label}</span>
                <span className={styles.detail}>{suggestion.detail}</span>
                <AvailabilityBadge availability={suggestion.region.availability} compact />
              </li>
            ))}
          </ul>

          {hint !== null ? <p className={styles.hint}>{hint}</p> : null}
        </div>
      ) : null}

      {error !== null ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
