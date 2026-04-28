import React from 'react';
import type { HybridEntity } from '@syncrohws/shared-types';

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

function IconFiles({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconPomodoro({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2" />
      <path d="M5 3L2 6" />
      <path d="M22 6l-3-3" />
      <line x1="12" y1="5" x2="12" y2="3" />
    </svg>
  );
}

function IconHabit({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 3v18" />
    </svg>
  );
}

function IconBookmark({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ── Icon registry ─────────────────────────────────────────────────────────────

const iconMap: Record<string, React.FC<{ className?: string }>> = {
  notes: IconNotes,
  tasks: IconTasks,
  calendar: IconCalendar,
  timer: IconTimer,
  files: IconFiles,
  pomodoro: IconPomodoro,
  habit: IconHabit,
  bookmark: IconBookmark,
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
  /**
   * Phase B — Optional aspect plugin block. Modules that own an aspect type
   * declare it here; ToolRegistry then exposes an editor + summary component
   * to the universal `EntityDetailSheet`.
   */
  aspect?: {
    type: string;
    label: string;
    defaultData: Record<string, unknown>;
    requiresToolInstance: boolean;
  };
}

// ── Tool interface ────────────────────────────────────────────────────────────

export interface ToolViewProps {
  toolInstanceId?: string;
}

export interface Tool {
  id: string;
  name: string;
  icon: React.FC<{ className?: string }>;
  component: React.FC<ToolViewProps>;
  /** Keyboard shortcut number (Ctrl+N). Omit for no shortcut. */
  shortcut?: string;
  /** Entity types this tool manages (for nav:open-entity mapping). */
  entityTypes?: string[];
  /** Module init function called at bootstrap. */
  init?: () => void;
  /** Full manifest metadata. */
  manifest?: ToolManifest;
  /**
   * Optional custom renderer for search results in the command palette.
   * If omitted, the default title + type badge is used.
   */
  renderSearchResult?: (entity: HybridEntity) => React.ReactNode;
  /**
   * Extract a display title from a hybrid entity.
   * If omitted, falls back to core.title.
   */
  getEntityTitle?: (entity: HybridEntity) => string;
  /**
   * Extract a short subtitle / description from a hybrid entity.
   * Shown below the title in search results.
   */
  getEntitySubtitle?: (entity: HybridEntity) => string | undefined;
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

// ── Aspect plugin registry (Phase B) ──────────────────────────────────────────
//
// Aspect plugins describe how a single aspect type is rendered + edited inside
// the universal `EntityDetailSheet`. A module declares its aspect in
// manifest.json (`aspect: { … }`) and contributes an `AspectEditor.tsx` file;
// the registry stitches them together at boot.

import type { EntityAspect, EntityCore } from '@syncrohws/shared-types';

export interface AspectEditorProps {
  /** Shared core (read-only here — edited via the General tab). */
  core: EntityCore;
  /** The aspect being edited. */
  aspect: EntityAspect;
  /** Patch this aspect's `data` (deep-merged + revalidated by the entityStore). */
  onChange: (data: Record<string, unknown>) => void;
  /** Detach this aspect from the entity. */
  onRemove: () => void;
}

export interface AspectSummaryProps {
  core: EntityCore;
  aspect: EntityAspect;
}

export interface AspectPlugin {
  /** Aspect type id (must match an entry in ASPECT_TYPES). */
  type: string;
  /** Display label for the detail-sheet tab. */
  label: string;
  /** Owning tool (manifest.id) — used to resolve target tool instances. */
  toolId: string;
  /** Lucide-style icon component (re-uses tool's icon by default). */
  icon: React.FC<{ className?: string }>;
  /** Default `data` payload when this aspect is freshly attached. */
  defaultData: Record<string, unknown>;
  /** Whether the aspect must be scoped to a tool instance (board/calendar). */
  requiresToolInstance: boolean;
  /** React component rendered inside the corresponding tab of EntityDetailSheet. */
  editorComponent: React.FC<AspectEditorProps>;
  /** Optional compact summary (used in list-row badges, link previews, …). */
  summaryComponent?: React.FC<AspectSummaryProps>;
}

const _aspectPlugins: Map<string, AspectPlugin> = new Map();

export function registerAspectPlugin(plugin: AspectPlugin): void {
  _aspectPlugins.set(plugin.type, plugin);
}

export function getAspectPlugin(type: string): AspectPlugin | undefined {
  return _aspectPlugins.get(type);
}

export function getAllAspectPlugins(): AspectPlugin[] {
  return [..._aspectPlugins.values()];
}

// ── Manifest-based auto-discovery ─────────────────────────────────────────────

// Eagerly import all manifest.json files under modules/
const manifests = import.meta.glob<{ default: ToolManifest } | ToolManifest>(
  '../modules/*/manifest.json',
  { eager: true },
);

// Eagerly import all module index.ts files (for init + entity hooks)
const moduleInits = import.meta.glob<{
  init?: () => void;
  renderSearchResult?: (entity: HybridEntity) => React.ReactNode;
  getEntityTitle?: (entity: HybridEntity) => string;
  getEntitySubtitle?: (entity: HybridEntity) => string | undefined;
}>(
  '../modules/*/index.ts',
  { eager: true },
);

// Eagerly import all view components — convention: *View.tsx in each module folder
const moduleViews = import.meta.glob<{ [key: string]: React.FC }>(
  '../modules/*/*.tsx',
  { eager: true },
);

// Eagerly import all aspect editors — convention: AspectEditor.tsx in each module folder
const aspectEditors = import.meta.glob<{
  default?: React.FC<AspectEditorProps>;
  AspectEditor?: React.FC<AspectEditorProps>;
  AspectSummary?: React.FC<AspectSummaryProps>;
}>(
  '../modules/*/AspectEditor.tsx',
  { eager: true },
);

// Also check ui/ModuleViews.tsx for fallback components
import * as fallbackViews from '@/ui/ModuleViews';

/**
 * Discover and register all tools from their manifest.json files.
 * Called once during app bootstrap.
 */
export function discoverAndRegisterTools(): void {
  for (const [manifestPath, rawManifest] of Object.entries(manifests)) {
    // Handle both { default: {...} } and direct object forms
    const manifest: ToolManifest =
      (rawManifest as { default?: ToolManifest }).default ?? (rawManifest as ToolManifest);

    if (!manifest?.id) {
      console.warn(`[registry] Invalid manifest at "${manifestPath}", skipping.`);
      continue;
    }

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
      renderSearchResult: initModule?.renderSearchResult,
      getEntityTitle: initModule?.getEntityTitle,
      getEntitySubtitle: initModule?.getEntitySubtitle,
    });

    // Phase B — Register aspect plugin if both the manifest declares one
    // AND the module ships an AspectEditor.tsx.
    if (manifest.aspect) {
      const editorModule = aspectEditors[`../modules/${folder}/AspectEditor.tsx`];
      const editorComponent = editorModule?.AspectEditor ?? editorModule?.default;
      if (editorComponent) {
        registerAspectPlugin({
          type: manifest.aspect.type,
          label: manifest.aspect.label,
          toolId: manifest.id,
          icon,
          defaultData: manifest.aspect.defaultData,
          requiresToolInstance: manifest.aspect.requiresToolInstance,
          editorComponent,
          summaryComponent: editorModule?.AspectSummary,
        });
      } else {
        console.warn(
          `[registry] Module "${manifest.id}" declares aspect "${manifest.aspect.type}" but no AspectEditor.tsx was found.`,
        );
      }
    }
  }

  console.log(
    `[registry] Discovered ${_tools.size} tools, ${_aspectPlugins.size} aspect plugins`,
  );
}
