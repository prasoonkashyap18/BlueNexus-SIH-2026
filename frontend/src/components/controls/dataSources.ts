/* ==================================================================== *
 *  Step 51 — the data-source / provenance model for the UI.
 *
 *  The authoritative catalogue is the backend `GET /api/sources`
 *  (`useSourceCatalog`). This module is the pure glue around it:
 *
 *   - `STATIC_SOURCE_CATALOG` — an identity-only fallback (labels / dataset ids
 *     / units / model-vs-observation kind, all stable config constants) so the
 *     source panel still names every dataset correctly when the API is
 *     unreachable. It carries NO coverage / time values — those are only ever
 *     shown from the live backend, never invented here.
 *   - lookups from the selected UI state (ocean variable, selected observation)
 *     to the source(s) that are actually supplying the current view.
 *   - small display formatters.
 *
 *  Nothing here fetches, and nothing transforms a scientific value.
 * ==================================================================== */

import type { OceanVariable } from '../../state/visualizationState'
import type {
  DataSourceCoverage,
  DataSourceInfo,
  DataSourceKey,
  SourceCatalogResponse,
} from '../../api/types'

/** Which catalogue entry supplies each selectable 3D field variable. */
export const SOURCE_KEY_BY_VARIABLE: Record<OceanVariable, DataSourceKey | null> = {
  temperature: 'temperature',
  salinity: 'salinity',
  currentSpeed: 'currents',
  chlorophyll: null,
}

/** Which catalogue entry describes each selected observation family. */
export const SOURCE_KEY_BY_OBSERVATION: Record<'argo' | 'glider', DataSourceKey> = {
  argo: 'argo',
  glider: 'gliders',
}

/**
 * The viewport HUD's per-field source tag (Step 51 — single home for these
 * strings, previously hard-coded in `ViewportOverlay`). Keyed by the ocean
 * variable id the HUD holds.
 */
export const FIELD_STATUS_TAG: Record<
  'temperature' | 'salinity' | 'currentSpeed',
  { tag: string; title: string }
> = {
  temperature: {
    tag: 'INCOIS Ocean Analysis',
    title:
      'INCOIS Argo 10-day objective-analysis temperature (°C), served by the BlueNexus data API',
  },
  salinity: {
    tag: 'INCOIS Ocean Analysis',
    title:
      'INCOIS Argo 10-day objective-analysis salinity (PSU), served by the BlueNexus data API',
  },
  currentSpeed: {
    tag: 'INCOIS IO-HOOFS',
    title:
      'INCOIS IO-HOOFS operational surface-current forecast (m/s) — a model forecast, not a real-time observation',
  },
}

/** Human label for the `kind` discriminator — never colour-only in the UI. */
export const KIND_LABEL: Record<DataSourceInfo['kind'], string> = {
  analysis: 'Analysis',
  forecast: 'Model forecast',
  reanalysis: 'Model reanalysis',
  observation: 'In-situ observation',
}

/* ------------------------------------------------------------------ *
 * Identity-only fallback (no coverage / no timestamps)
 * ------------------------------------------------------------------ */

const NO_COVERAGE: DataSourceCoverage | null = null

export const STATIC_SOURCE_CATALOG: SourceCatalogResponse = {
  count: 6,
  sources: [
    {
      key: 'temperature',
      category: 'field',
      context_label: 'Temperature',
      label: 'INCOIS Ocean Analysis',
      kind: 'analysis',
      is_model: false,
      is_incois: true,
      organization: 'Indian National Centre for Ocean Information Services (INCOIS)',
      dataset_id: 'incois_argo_10day_analysis',
      product_identifier: 'incois_argo_10day_McCreary',
      product_title: 'INCOIS ARGO 10 Day data Kessler-McCreary Methodology',
      variable: {
        name: 'T_ANALYZED',
        display: 'Objectively analysed sea-water temperature',
        standard_name: null,
      },
      units: 'degC',
      temporal_semantics: null,
      coverage: NO_COVERAGE,
      subset_note: null,
      url: 'https://erddap.incois.gov.in/erddap/griddap/incois_argo_10day_McCreary.html',
      attribution: null,
    },
    {
      key: 'salinity',
      category: 'field',
      context_label: 'Salinity',
      label: 'INCOIS Ocean Analysis',
      kind: 'analysis',
      is_model: false,
      is_incois: true,
      organization: 'Indian National Centre for Ocean Information Services (INCOIS)',
      dataset_id: 'incois_argo_10day_analysis',
      product_identifier: 'incois_argo_10day_McCreary',
      product_title: 'INCOIS ARGO 10 Day data Kessler-McCreary Methodology',
      variable: {
        name: 'S_ANALYZED',
        display: 'Objectively analysed practical salinity',
        standard_name: 'sea_water_practical_salinity',
      },
      units: 'PSU',
      temporal_semantics: null,
      coverage: NO_COVERAGE,
      subset_note: null,
      url: 'https://erddap.incois.gov.in/erddap/griddap/incois_argo_10day_McCreary.html',
      attribution: null,
    },
    {
      key: 'currents',
      category: 'field',
      context_label: 'Surface current',
      label: 'INCOIS IO-HOOFS',
      kind: 'forecast',
      is_model: true,
      is_incois: true,
      organization: 'Indian National Centre for Ocean Information Services (INCOIS)',
      dataset_id: 'incois_io_hoofs_surface_currents',
      product_identifier: 'CURRENTS_IO_20260904.nc',
      product_title: 'IO-HOOFS operational surface-current forecast',
      variable: {
        name: 'CURRENT',
        display: 'Surface current speed (from U/V)',
        standard_name: null,
      },
      units: 'm s-1',
      temporal_semantics: null,
      coverage: NO_COVERAGE,
      subset_note: null,
      url: 'https://incois.gov.in/thredds/catalog/osf/currents/catalog.html',
      attribution: null,
    },
    {
      key: 'argo',
      category: 'observation',
      context_label: 'Argo observation',
      label: 'INCOIS Indian_ARGO_Floats',
      kind: 'observation',
      is_model: false,
      is_incois: true,
      organization: 'Indian National Centre for Ocean Information Services (INCOIS)',
      access_via: 'INCOIS ERDDAP',
      dataset_id: 'incois_indian_argo_floats',
      product_identifier: 'Indian_ARGO_Floats',
      product_title: 'INDIAN ARGO Floats Data',
      variable: {
        name: 'temperature, salinity, pressure',
        display: 'In-situ CTD temperature & practical salinity vs pressure',
        standard_name: null,
      },
      units: { temperature: 'degree_Celsius', salinity: 'PSU', pressure: 'decibar' },
      temporal_semantics: null,
      coverage: NO_COVERAGE,
      subset_note: null,
      url: 'https://erddap.incois.gov.in/erddap/tabledap/Indian_ARGO_Floats.html',
      attribution: null,
    },
    {
      key: 'gliders',
      category: 'observation',
      context_label: 'Glider observation',
      label: 'EGO / OceanGliders GDAC',
      kind: 'observation',
      is_model: false,
      is_incois: false,
      organization: "OceanGliders (GOOS) / EGO - Everyone's Gliding Observatories",
      access_via: 'IFREMER / Coriolis ERDDAP',
      dataset_id: 'ego_oceangliders_gdac',
      product_identifier: 'OceanGlidersGDACTrajectories',
      product_title: 'EGO / OceanGliders GDAC trajectories',
      variable: {
        name: 'temperature, salinity, pressure',
        display: 'In-situ CTD temperature & practical salinity vs pressure',
        standard_name: null,
      },
      units: { temperature: 'degree_Celsius', salinity: 'PSU', pressure: 'decibar' },
      temporal_semantics: null,
      coverage: NO_COVERAGE,
      subset_note: null,
      url: 'https://erddap.ifremer.fr/erddap/tabledap/OceanGlidersGDACTrajectories.html',
      attribution: null,
    },
    {
      key: 'model_comparison',
      category: 'comparison',
      context_label: 'Model (temperature comparison)',
      label: 'GLORYS12V1 / Copernicus Marine',
      kind: 'reanalysis',
      is_model: true,
      is_incois: false,
      organization: 'E.U. Copernicus Marine Service (CMEMS) / Mercator Ocean International',
      dataset_id: 'glorys12v1_model',
      product_identifier: 'GLOBAL_MULTIYEAR_PHY_001_030',
      copernicus_dataset_id: 'cmems_mod_glo_phy_my_0.083deg_P1D-m',
      doi: 'https://doi.org/10.48670/moi-00021',
      product_title: 'Global Ocean Physics Reanalysis (GLORYS12V1)',
      variable: {
        name: 'thetao',
        display: 'Sea-water potential temperature (thetao)',
        standard_name: 'sea_water_potential_temperature',
      },
      units: 'degrees_C',
      temporal_semantics:
        'Daily-mean reanalysis fields (not instantaneous, not a forecast, not an observation).',
      coverage: NO_COVERAGE,
      subset_note:
        'Regional validation subset — a small Arabian Sea extract of the global product, not the full GLORYS12V1 archive.',
      url: 'https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_PHY_001_030/description',
      attribution:
        'Generated using E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00021',
    },
  ],
  notes: [
    'Every label corresponds to a real dataset the application uses; none is a demo or placeholder.',
    'GLORYS12V1 is Copernicus Marine / Mercator Ocean data, used only for the model–observation temperature comparison. It is NOT INCOIS data.',
  ],
}

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

export function findSource(
  catalog: SourceCatalogResponse,
  key: DataSourceKey,
): DataSourceInfo | null {
  return catalog.sources.find((s) => s.key === key) ?? null
}

/** The source for the selected 3D field variable (`null` for chlorophyll). */
export function fieldSource(
  catalog: SourceCatalogResponse,
  variable: OceanVariable,
): DataSourceInfo | null {
  const key = SOURCE_KEY_BY_VARIABLE[variable]
  return key === null ? null : findSource(catalog, key)
}

/** The source for a selected observation family. */
export function observationSource(
  catalog: SourceCatalogResponse,
  family: 'argo' | 'glider',
): DataSourceInfo | null {
  return findSource(catalog, SOURCE_KEY_BY_OBSERVATION[family])
}

export function comparisonSources(
  catalog: SourceCatalogResponse,
): { model: DataSourceInfo | null; observation: DataSourceInfo | null } {
  return { model: findSource(catalog, 'model_comparison'), observation: findSource(catalog, 'argo') }
}

/* ------------------------------------------------------------------ *
 * Display formatters (pure)
 * ------------------------------------------------------------------ */

/** `"degC"` → `"°C"`, `"m s-1"` → `"m/s"`, a unit map → its temperature unit. */
export function primaryUnit(units: DataSourceInfo['units']): string {
  const raw = typeof units === 'string' ? units : (units?.temperature ?? null)
  if (raw === null || raw === undefined || raw === '') return '—'
  const map: Record<string, string> = {
    degC: '°C',
    degrees_C: '°C',
    degree_Celsius: '°C',
    PSU: 'PSU',
    'm s-1': 'm/s',
    'm s⁻¹': 'm/s',
    decibar: 'dbar',
  }
  return map[raw] ?? raw
}

/** `{min,max,units}` → `"8.0–20.5 °N"`; `null` when absent. */
export function formatLatLon(range: { min?: number | null; max?: number | null } | undefined, axis: 'lat' | 'lon'): string | null {
  if (range === undefined || range.min === null || range.min === undefined || range.max === null || range.max === undefined) {
    return null
  }
  const hemi = axis === 'lat' ? ('°N') : ('°E')
  return `${range.min.toFixed(1)}–${range.max.toFixed(1)} ${hemi}`
}

/** `{min,max,units,count}` → `"0.5–541 m (32 levels)"`; `null` when absent. */
export function formatDepthRange(depth: DataSourceCoverage['depth'] | undefined): string | null {
  if (depth === undefined) return null
  if (depth.surface_only) return 'Surface only (0 m)'
  if (depth.min === null || depth.min === undefined || depth.max === null || depth.max === undefined) return null
  const levels = typeof depth.count === 'number' ? ` (${depth.count} levels)` : ''
  return `${round(depth.min)}–${round(depth.max)} m${levels}`
}

/** `{start,end,count}` → `"2025-03-24 → 2025-04-02 (10 steps)"`; `null` when absent. */
export function formatTimeCoverage(time: DataSourceCoverage['time'] | undefined): string | null {
  if (time === undefined || (time.start === null && time.end === null)) return null
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')
  const steps = typeof time.count === 'number' ? ` (${time.count} step${time.count === 1 ? '' : 's'})` : ''
  return time.start === time.end ? `${day(time.start)}${steps}` : `${day(time.start)} → ${day(time.end)}${steps}`
}

function round(value: number): string {
  return String(Number(value.toFixed(value < 10 ? 1 : 0)))
}
