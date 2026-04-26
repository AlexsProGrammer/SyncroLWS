import * as React from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './context-menu';
import { eventBus } from '@/core/events';
import { getAllAspectPlugins } from '@/registry/ToolRegistry';
import { softDeleteEntity } from '@/core/entityStore';
import type { AspectType } from '@syncrohws/shared-types';

// ── Props ────────────────────────────────────────────────────────────────────

export interface EntityRowContextMenuProps {
  /** The entity (core id) the row represents. */
  entityId: string;
  /** Aspect types the entity already owns (hidden from "Add" menu). */
  existingTypes: string[];
  /** Optional: hint for which tab to show when "Open details" is chosen. */
  openInitialAspectType?: AspectType;
  /** When provided, replaces the default soft-delete behaviour (e.g. for views
   *  that need optimistic state cleanup). */
  onDelete?: () => void | Promise<void>;
  /** Skip the delete entry entirely. */
  hideDelete?: boolean;
  children: React.ReactNode;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Universal right-click menu for an entity row in any tool's list view (Phase D).
 *
 *   • Open details (universal sheet)
 *   • Add <aspect> ……  (one item per missing aspect plugin → AddAspectDialog)
 *   • Delete entity
 *
 * Wrap your row element (the visual container — usually a `div` or `tr`) with
 * this and the right-click experience is consistent across every module.
 */
export function EntityRowContextMenu({
  entityId,
  existingTypes,
  openInitialAspectType,
  onDelete,
  hideDelete,
  children,
}: EntityRowContextMenuProps): React.ReactElement {
  const missing = React.useMemo(
    () => getAllAspectPlugins().filter((p) => !existingTypes.includes(p.type)),
    [existingTypes],
  );

  function openDetails(): void {
    eventBus.emit('nav:open-detail-sheet', {
      id: entityId,
      ...(openInitialAspectType ? { initialAspectType: openInitialAspectType } : {}),
    });
  }

  function addAspect(type: string): void {
    eventBus.emit('nav:add-aspect', {
      entityId,
      existingTypes,
      initialType: type as AspectType,
    });
  }

  async function handleDelete(): Promise<void> {
    if (onDelete) {
      await onDelete();
      return;
    }
    const ok = window.confirm('Delete this entity everywhere? This cannot be undone.');
    if (!ok) return;
    await softDeleteEntity(entityId);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[14rem]">
        <ContextMenuItem onSelect={openDetails}>Open details…</ContextMenuItem>
        {missing.length > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-xs text-muted-foreground">
              Promote to…
            </ContextMenuLabel>
            {missing.map((p) => {
              const Icon = p.icon;
              return (
                <ContextMenuItem key={p.type} onSelect={() => addAspect(p.type)}>
                  <Icon className="mr-2 h-4 w-4" />
                  Add {p.label}
                </ContextMenuItem>
              );
            })}
          </>
        )}
        {!hideDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => void handleDelete()}
              className="text-destructive focus:text-destructive"
            >
              Delete entity
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
