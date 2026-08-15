import registry from './surface-registry.json';

export const UI_SURFACE_IDS = registry.surfaces.map(({ id }) => id) as UiSurfaceId[];

export type UiSurfaceId =
  | 'session-boundary'
  | 'pwa-status'
  | 'workspace-shell'
  | 'document-authoring'
  | 'reflection-margin'
  | 'connections'
  | 'library-drawer'
  | 'snapshot-editor'
  | 'hosted-snapshot';
