import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CameraViewContext,
  DEFAULT_CAMERA_VIEW_STATE,
  type CameraViewActions,
  type CameraViewState,
} from './cameraViewState'

/** Keyboard shortcut for "reset view", matching the viewport's hint. */
const RESET_KEY = 'r'

/**
 * True for the elements a keystroke belongs to rather than to the viewport.
 *
 * The control panel is full of range inputs and selects, and a bare letter key
 * pressed while one of them has focus must not fly the camera home behind the
 * reader's back.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

interface CameraViewProviderProps {
  children: ReactNode
}

/**
 * Owns the camera's view state for the whole application.
 *
 * It is the seam between the UI and the scene's camera: the control panel and
 * the `R` shortcut push reset requests in, the scene pulls them out and
 * reports back whether the camera is still at home. Neither side holds a
 * handle on the other, so the button works whether or not a scene is mounted
 * and the scene needs no knowledge of the panel that drives it.
 *
 * It is kept separate from the visualization store on purpose: that store
 * describes *what* is drawn and is safe to serialise into a deep link, while
 * this one is an imperative channel to the renderer.
 */
export function CameraViewProvider({ children }: CameraViewProviderProps) {
  const [state, setState] = useState<CameraViewState>(DEFAULT_CAMERA_VIEW_STATE)

  const actions = useMemo<CameraViewActions>(
    () => ({
      resetView: () =>
        setState((current) => ({ ...current, resetRequest: current.resetRequest + 1 })),

      // Called from the scene's frame loop, so it bails out on the unchanged
      // value rather than handing React a new object sixty times a second.
      reportAtHome: (atHome: boolean) =>
        setState((current) => (current.atHome === atHome ? current : { ...current, atHome })),
    }),
    [],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== RESET_KEY) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (isTypingTarget(event.target)) return

      actions.resetView()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions])

  const value = useMemo(() => ({ state, actions }), [state, actions])

  return <CameraViewContext value={value}>{children}</CameraViewContext>
}
