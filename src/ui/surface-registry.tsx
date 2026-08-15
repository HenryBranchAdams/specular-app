import type { ComponentPropsWithoutRef, ReactNode } from 'react';
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

interface SurfaceBoundaryProps extends ComponentPropsWithoutRef<'div'> {
  children: ReactNode;
  surface: UiSurfaceId;
}

export function SurfaceBoundary({ children, surface, ...props }: SurfaceBoundaryProps) {
  return <div data-ui-surface={surface} {...props}>{children}</div>;
}
