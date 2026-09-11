import { DataApiConnectionProbe } from './api/DataApiConnectionProbe.tsx'
import { DevCrashProbe } from './components/feedback/DevCrashProbe.tsx'
import { AppShell } from './components/layout/AppShell'
import { ArgoObservationsProvider } from './state/ArgoObservationsProvider'
import { CameraViewProvider } from './state/CameraViewProvider'
import { CurrentDataProvider } from './state/CurrentDataProvider'
import { GliderObservationsProvider } from './state/GliderObservationsProvider'
import { LocationProvider } from './state/LocationProvider'
import { ObservationProvider } from './state/ObservationProvider'
import { SalinityDataProvider } from './state/SalinityDataProvider'
import { TemperatureDataProvider } from './state/TemperatureDataProvider'
import { VisualizationProvider } from './state/VisualizationProvider'

function App() {
  return (
    <LocationProvider>
      <VisualizationProvider>
        {/*
          D12: fetches the real INCOIS temperature grid through the D11 API
          client and exposes it via `useTemperatureData`. D13 adds the sibling
          salinity (same analysis dataset) and surface-current (INCOIS IO-HOOFS
          forecast, its own grid) providers. All three sit inside
          VisualizationProvider because each maps the selected time to a real
          time index for its own dataset. The 3D scene, the colorbar and the
          HUD tag read them.
        */}
        <TemperatureDataProvider>
          <SalinityDataProvider>
            <CurrentDataProvider>
              <CameraViewProvider>
                <ObservationProvider>
                  {/*
                    Step 28: real INCOIS Argo float profiles (point/profile
                    data from the ERDDAP `Indian_ARGO_Floats` snapshot). Sits
                    inside ObservationProvider so the markers (Step 30) and the
                    observation panel (Step 31) resolve the shared platform
                    selection against it; kept separate from the model grid.
                  */}
                  <ArgoObservationsProvider>
                    {/*
                      Step 29: real EGO / OceanGliders GDAC underwater-glider
                      deployments (trajectory data from the IFREMER ERDDAP
                      `OceanGlidersGDACTrajectories` snapshot). Same pattern as
                      the Argo provider; independent of it; kept off the model
                      grid. Feeds the Step 30 tracks and the Step 31 panel.
                    */}
                    <GliderObservationsProvider>
                      {/*
                        D11: development-only probe. Makes real requests to the D10
                        data API on load and logs the result; renders nothing.
                      */}
                      {import.meta.env.DEV ? <DataApiConnectionProbe /> : null}
                      {/*
                        Step 55: development-only probe for the root error
                        boundary (main.tsx). Absent from production builds;
                        arms via a hidden control, a window event, or `?crash`.
                      */}
                      {import.meta.env.DEV ? <DevCrashProbe /> : null}
                      <AppShell />
                    </GliderObservationsProvider>
                  </ArgoObservationsProvider>
                </ObservationProvider>
              </CameraViewProvider>
            </CurrentDataProvider>
          </SalinityDataProvider>
        </TemperatureDataProvider>
      </VisualizationProvider>
    </LocationProvider>
  )
}

export default App
