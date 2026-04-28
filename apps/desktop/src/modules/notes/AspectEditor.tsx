import * as React from 'react';
import { RichTextEditor } from '@/ui/components/RichTextEditor';
import type { AspectEditorProps } from '@/registry/ToolRegistry';
import type { NoteAspectData } from '@syncrohws/shared-types';
import { Button } from '@/ui/components/button';
import { eventBus } from '@/core/events';
import { getEntity, reconcileWikiLinks } from '@/core/entityStore';
import { ai, getAISettings } from '@/core/ai';

/**
 * Notes aspect editor — thin wrapper around the shared `RichTextEditor` that
 * adds notes-specific concerns: wiki-link click resolution and the post-save
 * `reconcileWikiLinks` side-effect (Phase E).
 */
export function AspectEditor({ core, aspect, onChange, onRemove }: AspectEditorProps): React.ReactElement {
  const data = aspect.data as Partial<NoteAspectData>;
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);

  const onSummarize = async (): Promise<void> => {
    setAiBusy(true); setAiError(null);
    try {
      const settings = await getAISettings();
      if (!settings.enabled) {
        setAiError('Enable AI in Settings → AI first.');
        return;
      }
      const md = (data.content_md ?? '').trim();
      if (md.length < 30) {
        setAiError('Note is too short to summarize.');
        return;
      }
      const summary = await ai.summarize(md, { sentences: 3 });
      const next = `> **AI summary:** ${summary}\n\n${md}`;
      onChange({ content_md: next });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <RichTextEditor
        contentJson={data.content_json}
        contentMd={data.content_md}
        placeholder="Start writing…"
        minHeight={240}
        autosaveMs={600}
        showToolbar
        features={{
          wikiLinks: true,
          tagHighlight: true,
          taskList: true,
          typography: true,
          highlight: true,
          link: true,
          codeBlock: true,
          slashMenu: true,
        }}
        onChange={({ content_md, content_json }) => {
          onChange({ content_md, content_json });
          void reconcileWikiLinks(core.id, content_md).catch((err) => {
            console.error('[notes] wiki-link reconcile failed:', err);
          });
        }}
        onWikiLinkClick={(linkText) => {
          void resolveAndOpenLink(linkText);
        }}
        className="note-editor-content flex-1 overflow-y-auto"
      />

      <div className="border-t border-border px-2 py-2 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void onSummarize()} disabled={aiBusy}>
          {aiBusy ? 'Summarizing…' : 'AI summarize'}
        </Button>
        {aiError && <span className="text-xs text-red-500">{aiError}</span>}
        <div className="flex-1" />
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove note aspect
        </Button>
      </div>
    </div>
  );
}

async function resolveAndOpenLink(linkText: string): Promise<void> {
  try {
    const { getWorkspaceDB } = await import('@/core/db');
    const db = getWorkspaceDB();
    const rows = await db.select<{ id: string }[]>(
      `SELECT id FROM base_entities WHERE title = ? AND deleted_at IS NULL LIMIT 1`,
      [linkText],
    );
    if (rows[0]) {
      const hybrid = await getEntity(rows[0].id);
      if (hybrid) {
        eventBus.emit('nav:open-detail-sheet', { id: hybrid.core.id, initialAspectType: 'note' });
      }
    }
  } catch (err) {
    console.error('[notes/AspectEditor] link resolution failed:', err);
  }
}
