import { useEffect, useRef, useState, type RefObject } from 'react'

export interface ElementSize {
  /** CSS pixels, rounded. `0` until the element has been measured once. */
  width: number
  height: number
}

const UNMEASURED: ElementSize = { width: 0, height: 0 }

/**
 * Tracks the rendered size of an element.
 *
 * Written for the visualization viewport: the scene readout shows it today,
 * and the renderer needs the same measurement to size its drawing buffer once
 * the 3D engine mounts. Returns a stable object while the size is unchanged,
 * so consumers can memo on it.
 */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, ElementSize] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<ElementSize>(UNMEASURED)

  useEffect(() => {
    const element = ref.current
    if (element === null) return

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box === undefined) return

      const width = Math.round(box.width)
      const height = Math.round(box.height)

      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      )
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, size]
}
