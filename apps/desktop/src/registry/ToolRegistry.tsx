import React from 'react';

// ── Icons (inline SVG — no external CDN, DSGVO compliant) ──────────────────

function IconNotes({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconTasks({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconCalendar({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconTimer({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// ── Icon registry ─────────────────────────────────────────────────────────────

const iconMap: Record<string, React.FC<{ className?: string }>> = {
  notes: IconNotes,
  tasks: IconTasks,
  calendar: IconCalendar,
  timer: IconTimer,
};

// ── Manifest type ─────────────────────────────────────────────────────────────

export interface ToolManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  entityTypes: string[];
  shortcut?: string;
  hasPortalView: boolean;
  portalPermissions: string[];
  configSchema: Record<string, unknown>;
}

// ── Tool interface ────────────────────────────────────────────────────────────

export interface Tool {
  id: string;
  name: string;
  icon: React.FC<{ className?: string }>;
  component: React.FC;
  /** Keyboard shortcut number (Ctrl+N). Omit for no shortcut. */
  shortcut?: string;
  /** Entity types this tool manages (for nav:open-entity mapping). */
  entityTypes?: string[];
  /** Module init function called at bootstrap. */
  init?: () => void;
  /** Full manifest metadata. */
  manifest?: ToolManifest;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const _tools: Map<string, Tool> = new Map();

/**
 * Register a tool in the global registry.
 * Duplicate IDs overwrite — last registration wins.
 */
export function registerTool(tool: Tool): void {
  _tools.set(tool.id, tool);
}

/** Get a tool by id (or undefined if not registered). */
export function getTool(id: string): Tool | undefined {
  return _tools.get(id);
}

/** Get all registered tools as an ordered array. */
export function getAllTools(): Tool[] {
  return [..._tools.values()];
}

/** Find a tool by one of its entity types. */
export function getToolByEntityType(entityType: string): Tool | undefined {
  return getAllTools().find((t) => t.entityTypes?.includes(entityType));
}

// ── Manifest-based auto-discovery ─────────────────────────────────────────────

// Eagerly import all manifest.json files under modules/
const manifests = import.meta.glob<ToolManifest>(
  '../modules/*/manifest.json',
  { eager: true, import: 'default' },
);

// Eagerly import all module index.ts files (for init functions)
const moduleInits = import.meta.glob<{ init?: () => void }>(
  '../modules/*/index.ts',
  { eager: true },
);

// Eagerly import all view components — convention: *View.tsx in each module folder
const moduleViews = import.meta.glob<{ [key: string]: React.FC }>(
  '../modules/*/*.tsx',
  { eager: true },
);

// Also check ui/ModuleViews.tsx for fallback components
import * as fallbackViews from '@/ui/ModuleViews';

/**
 * Discover and register all tools from their manifest.json files.
 * Called once during app bootstrap.
 */
export function discoverAndRegisterTools(): void {
  for (const [manifestPath, manifest] of Object.entries(manifests)) {
    // Extract module folder name: ../modules/<folder>/manifest.json → <folder>
    const folderMatch = manifestPath.match(/\.\.\/modules\/([^/]+)\/manifest\.json/);
    if (!folderMatch) continue;
    const folder = folderMatch[1];

    // Find init function
    const initModule = moduleInits[`../modules/${folder}/index.ts`];
    const init = initModule?.init;

    // Find view component — look for *View in module .tsx files
    let component: React.FC | undefined;

    for (const [viewPath, viewModule] of Object.entries(moduleViews)) {
      if (!viewPath.startsWith(`../modules/${folder}/`)) continue;
      // Find exported component ending with "View"
      const viewExport = Object.entries(viewModule).find(([key]) => key.endsWith('View'));
      if (viewExport) {
        component = viewExport[1] as React.FC;
        break;
      }
    }

    // Fallback: check ModuleViews.tsx for a component named <Name>View
    if (!component) {
      const pascalName = manifest.name.replace(/[^a-zA-Z0-9]/g, '') + 'View';
      component = (fallbackViews as Record<string, React.FC>)[pascalName];
    }

    if (!component) {
      console.warn(`[registry] No view component found for module "${manifest.id}", skipping.`);
      continue;
    }

    // Resolve icon
    const icon = iconMap[manifest.icon] ?? IconNotes;

    registerTool({
      id: manifest.id,
      name: manifest.name,
      icon,
      component,
      shortcut: manifest.shortcut,
      entityTypes: manifest.entityTypes,
      init,
      manifest,
    });
  }

  console.log(`[registry] Discovered ${_tools.size} tools`);
}
