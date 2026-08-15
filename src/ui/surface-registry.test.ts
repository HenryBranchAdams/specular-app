import { describe, expect, it } from 'vitest';
import componentInventory from '../../docs/design/specular-component-library-inventory.json';
import surfaceManifest from '../../docs/design/ui-surface-manifest.json';
import surfaceRegistry from './surface-registry.json';

describe('production UI surface ownership', () => {
  it('maps every active manifest surface to one production registry entry in both directions', () => {
    const manifestIds = surfaceManifest.surfaces.map(({ id }) => id).sort();
    const registryIds = surfaceRegistry.surfaces.map(({ id }) => id).sort();

    expect(manifestIds).toEqual(registryIds);
    expect(new Set(manifestIds).size).toBe(manifestIds.length);
  });

  it('reuses the approved component inventory and points to real stories and route scenarios', () => {
    const inventoryIds = new Set(componentInventory.entries.map(({ id }) => id));

    for (const surface of surfaceManifest.surfaces) {
      expect(surface.patternIds.length).toBeGreaterThan(0);
      expect(surface.patternIds.every((id) => inventoryIds.has(id))).toBe(true);
      expect(surface.storyIds.length + surface.routeScenarios.length).toBeGreaterThan(0);
      expect(surface.requiredStates.length).toBeGreaterThan(0);
    }
  });

  it('keeps the MCP widget explicit and outside active hosted-product coverage', () => {
    expect(surfaceManifest.legacyCompatibility).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'mcp-widget',
        coverage: 'excluded',
        source: 'public/specular-widget.html',
      }),
    ]));
    expect(surfaceRegistry.surfaces.some(({ id }) => id === 'mcp-widget')).toBe(false);
  });
});
