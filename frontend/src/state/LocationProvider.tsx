import { useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_REGION } from '../data/oceanRegions'
import {
  LocationContext,
  type LocationActions,
  type LocationState,
  type OceanRegion,
} from './locationState'

interface LocationProviderProps {
  children: ReactNode
  /** Overrides the opening region — used by tests and by deep links later on. */
  initialRegion?: OceanRegion
}

/**
 * Owns the ocean area the application is pointed at.
 *
 * This is the first half of the platform's intended workflow — search, locate,
 * *then* check datasets, choose one and load it — and it is kept deliberately
 * small so the later halves can be added around it rather than through it:
 * one region in, one availability state beside it, and a single action that
 * changes them. No component derives a location from anything else, and no
 * component writes one except through `selectRegion`.
 *
 * Held apart from the visualization store because the two answer different
 * questions. That one describes *what* is drawn — variable, depth, opacity —
 * and survives a change of location; this one describes *where*, and is what a
 * dataset query will eventually be built from.
 */
export function LocationProvider({
  children,
  initialRegion = DEFAULT_REGION,
}: LocationProviderProps) {
  const [state, setState] = useState<LocationState>(() => ({
    activeRegion: initialRegion,
    availability: initialRegion.availability,
  }))

  const actions = useMemo<LocationActions>(
    () => ({
      // Where the catalogue check goes: a later step sets `loading` here and
      // settles the availability once the lookup returns, without any consumer
      // of this store having to change.
      selectRegion: (activeRegion: OceanRegion) =>
        setState({ activeRegion, availability: activeRegion.availability }),
    }),
    [],
  )

  const value = useMemo(() => ({ state, actions }), [state, actions])

  return <LocationContext value={value}>{children}</LocationContext>
}
