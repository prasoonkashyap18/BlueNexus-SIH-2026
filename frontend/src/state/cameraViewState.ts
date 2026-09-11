import { createContext, useContext } from 'react'

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/**
 * The camera's relationship to its default framing.
 *
 * Deliberately *not* the camera pose. The pose lives in the scene, where it is
 * mutated every frame by the controls and by the frame loop; putting it in
 * React state would re-render the application at 60 Hz for no gain. What the
 * rest of the UI actually needs from the camera is two much smaller facts —
 * whether it has been moved, and when the user has asked for it back — and
 * those are what this store carries.
 */
export interface CameraViewState {
  /**
   * Incremented once per reset request.
   *
   * A counter rather than a boolean, because a reset is an *event*: two
   * requests in a row have to reach the scene as two flights, and a flag would
   * collapse them into one and then need clearing afterwards.
   */
  resetRequest: number
  /** True while the camera still holds its default framing. */
  atHome: boolean
}

export const DEFAULT_CAMERA_VIEW_STATE: CameraViewState = {
  resetRequest: 0,
  atHome: true,
}

export interface CameraViewActions {
  /** Ask the scene to return the camera to its default framing. */
  resetView: () => void
  /**
   * Reported by the scene when the camera enters or leaves its default
   * framing. The scene is the only writer — nothing else can know.
   */
  reportAtHome: (atHome: boolean) => void
}

export interface CameraViewContextValue {
  state: CameraViewState
  actions: CameraViewActions
}

export const CameraViewContext = createContext<CameraViewContextValue | null>(null)

function useCameraViewContext(hook: string): CameraViewContextValue {
  const value = useContext(CameraViewContext)
  if (value === null) {
    throw new Error(`${hook} must be used inside <CameraViewProvider>`)
  }
  return value
}

/** Read the camera's view state — the scene and the control panel both do. */
export function useCameraView(): CameraViewState {
  return useCameraViewContext('useCameraView').state
}

/** Request a reset, or report the camera's framing back to the store. */
export function useCameraViewControls(): CameraViewActions {
  return useCameraViewContext('useCameraViewControls').actions
}
