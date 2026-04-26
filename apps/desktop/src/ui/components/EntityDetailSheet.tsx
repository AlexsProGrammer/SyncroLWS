import * as React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';
import { Input } from './input';
import { Textarea } from './textarea';
import { Button } from './button';
import { Badge } from './badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { AddAspectDialog } from './AddAspectDialog';
import {
  getEntity,
  updateCore,
  updateAspect,
  removeAspect,
  softDeleteEntity,
} from '@/core/entityStore';
import { getAspectPlugin, getAllAspectPlugins } from '@/registry/ToolRegistry';
import { eventBus } from '@/core/events';
import type { EntityAspect, EntityCore, HybridEntity } from '@syncrohws/shared-types';

// ── Props ────────────────────────────────────────────────────────────────────

export interface EntityDetailSheetProps {
  /** Entity id to load and edit. Sheet auto-loads on open. */
  entityId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional initial tab — `general` or an aspect type. */
  initialTab?: string;
}

// ── Color palette ────────────────────────────────────────────────────────────

const COLOR_SWATCHES: readonly string[] = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
  '#64748b', // slate
];

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Universal tabbed editor for any base entity.
 *
 *  - Header: title, color, description, tags — all bind to `EntityCore` and
 *    persist via `updateCore`.
 *  - Tab strip: **General** + one tab per attached aspect, plus a "+ Add"
 *    dropdown for aspects not yet present.
 *  - Each aspect tab renders the plugin's `editorComponent` and forwards
 *    changes through `updateAspect` (which deep-merges + revalidates).
 */
export function EntityDetailSheet({
  entityId,
  open,
  onOpenChange,
  initialTab,
}: EntityDetailSheetProps): React.ReactElement | null {
  const [hybrid, setHybrid] = React.useState<HybridEntity | null>(null);
  const [activeTab, setActiveTab] = React.useState<string>(initialTab ?? 'general');
  const [addOpen, setAddOpen] = React.useState(false);
  const [addInitialType, setAddInitialType] = React.useState<string | undefined>();
  const [tagInput, setTagInput] = React.useState('');

  // Load entity when opened
  React.useEffect(() => {
    if (!open || !entityId) {
      setHybrid(null);
      return;
    }
    void getEntity(entityId).then((h) => {
      setHybrid(h);
      setActiveTab(initialTab ?? 'general');
    });
  }, [open, entityId, initialTab]);

  // Keep in sync with bus events for this entity
  React.useEffect(() => {
    if (!entityId) return;
    const reload = (): void => {
      void getEntity(entityId).then((h) => {
        if (h) setHybrid(h);
      });
    };
    eventBus.on('aspect:added', reload);
    eventBus.on('aspect:updated', reload);
    eventBus.on('aspect:removed', reload);
    eventBus.on('core:updated', reload);
    return () => {
      eventBus.off('aspect:added', reload);
      eventBus.off('aspect:updated', reload);
      eventBus.off('aspect:removed', reload);
      eventBus.off('core:updated', reload);
    };
  }, [entityId]);

  if (!open || !entityId) return null;

  const core = hybrid?.core;
  const aspects = hybrid?.aspects ?? [];
  const presentTypes: string[] = aspects.map((a) => a.aspect_type);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function patchCore(patch: Partial<EntityCore>): void {
    if (!core) return;
    setHybrid((h) => (h ? { ...h, core: { ...h.core, ...patch } } : h));
    void updateCore(core.id, patch);
  }

  function patchAspect(aspect: EntityAspect, dataPatch: Record<string, unknown>): void {
    setHybrid((h) =>
      h
        ? {
            ...h,
            aspects: h.aspects.map((a) =>
              a.id === aspect.id ? { ...a, data: { ...a.data, ...dataPatch } } : a,
            ),
          }
        : h,
    );
    void updateAspect(aspect.id, { data: dataPatch });
  }

  async function handleRemoveAspect(aspect: EntityAspect): Promise<void> {
    const confirmed = window.confirm(
      `Remove ${aspect.aspect_type} from this entity? Other aspects are kept.`,
    );
    if (!confirmed) return;
    await removeAspect(aspect.id);
    setActiveTab('general');
  }

  async function handleDeleteEntity(): Promise<void> {
    if (!core) return;
    const confirmed = window.confirm('Delete this entity everywhere? This cannot be undone.');
    if (!confirmed) return;
    await softDeleteEntity(core.id);
    onOpenChange(false);
  }

  function addTag(): void {
    if (!core) return;
    const t = tagInput.trim();
    if (!t || core.tags.includes(t)) return;
    patchCore({ tags: [...core.tags, t] });
    setTagInput('');
  }

  function removeTag(tag: string): void {
    if (!core) return;
    patchCore({ tags: core.tags.filter((t) => t !== tag) });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const missingAspectPlugins = (() => {
    return getAllAspectPlugins().filter((p) => !presentTypes.includes(p.type));
  })();

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full max-w-xl flex-col gap-0 sm:max-w-xl">
          <SheetHeader className="border-b border-border pb-3">
            <div className="flex items-start gap-3">
              {/* Color swatch button */}
              <ColorPicker
                value={core?.color ?? '#6366f1'}
                onChange={(c) => patchCore({ color: c })}
              />
              <div className="flex-1 space-y-2">
                <Input
                  value={core?.title ?? ''}
                  onChange={(e) => patchCore({ title: e.target.value })}
                  placeholder="Untitled"
                  className="border-0 px-0 text-lg font-semibold focus-visible:ring-0"
                />
                <SheetTitle className="sr-only">{core?.title ?? 'Entity'}</SheetTitle>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">⋯</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={handleDeleteEntity} className="text-destructive">
                    Delete entity
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {core?.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => removeTag(tag)}
                  title="Click to remove"
                >
                  #{tag} ×
                </Badge>
              ))}
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="add tag…"
                className="h-7 w-32 border-0 px-1 text-xs focus-visible:ring-0"
              />
            </div>
          </SheetHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="m-3 mb-0 justify-start overflow-x-auto">
              <TabsTrigger value="general">General</TabsTrigger>
              {aspects.map((a) => {
                const plugin = getAspectPlugin(a.aspect_type);
                return (
                  <TabsTrigger key={a.id} value={a.aspect_type} className="gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: core?.color ?? '#6366f1' }}
                    />
                    {plugin?.label ?? a.aspect_type}
                  </TabsTrigger>
                );
              })}
              {missingAspectPlugins.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="ml-1 h-7 px-2 text-xs">
                      + Add
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {missingAspectPlugins.map((p) => (
                      <DropdownMenuItem
                        key={p.type}
                        onSelect={() => {
                          setAddInitialType(p.type);
                          setAddOpen(true);
                        }}
                      >
                        <p.icon className="mr-2 h-4 w-4" />
                        {p.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </TabsList>

            {/* General tab */}
            <TabsContent value="general" className="flex-1 overflow-y-auto px-4 py-3">
              <div className="space-y-4">
                {missingAspectPlugins.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Quick promote
                    </label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {missingAspectPlugins.map((p) => {
                        const Icon = p.icon;
                        return (
                          <Button
                            key={p.type}
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => {
                              setAddInitialType(p.type);
                              setAddOpen(true);
                            }}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {labelForQuickAction(p.type, p.label)}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Description</label>
                  <Textarea
                    value={core?.description ?? ''}
                    onChange={(e) => patchCore({ description: e.target.value })}
                    placeholder="Describe this entity…"
                    rows={4}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Aspects</label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {aspects.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        This entity has no aspects yet. Use “+ Add” above.
                      </span>
                    )}
                    {aspects.map((a) => {
                      const plugin = getAspectPlugin(a.aspect_type);
                      return (
                        <Badge key={a.id} variant="outline" className="gap-1">
                          {plugin?.label ?? a.aspect_type}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Aspect tabs */}
            {aspects.map((a) => {
              const plugin = getAspectPlugin(a.aspect_type);
              return (
                <TabsContent
                  key={a.id}
                  value={a.aspect_type}
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {plugin && core ? (
                    <plugin.editorComponent
                      core={core}
                      aspect={a}
                      onChange={(data) => patchAspect(a, data)}
                      onRemove={() => void handleRemoveAspect(a)}
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No editor registered for aspect type “{a.aspect_type}”.
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </SheetContent>
      </Sheet>

      <AddAspectDialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setAddInitialType(undefined);
        }}
        entityId={entityId}
        existingTypes={presentTypes}
        initialType={addInitialType}
      />
    </>
  );
}

// ── Quick-promote labels ─────────────────────────────────────────────────────

const QUICK_LABELS: Record<string, string> = {
  task: 'Set priority/column',
  calendar_event: 'Schedule',
  time_log: 'Track time',
  bookmark: 'Bookmark this',
  note: 'Add note',
  habit: 'Track as habit',
  pomodoro_session: 'Start pomodoro',
};

function labelForQuickAction(type: string, fallback: string): string {
  return QUICK_LABELS[type] ?? `Add ${fallback}`;
}

// ── Color picker subcomponent ────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-8 w-8 rounded-md border border-border"
        style={{ backgroundColor: value }}
        aria-label="Pick color"
      />
      {open && (
        <div
          className="absolute left-0 top-10 z-50 grid grid-cols-5 gap-1.5 rounded-md border border-border bg-popover p-2 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className="h-6 w-6 rounded border border-border hover:scale-110"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
