import * as React from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { Extension, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Typography from '@tiptap/extension-typography';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import { createLowlight, common } from 'lowlight';
import {
  Bold, Italic, Strikethrough, Code as CodeIcon, Heading1, Heading2, Heading3,
  List, ListOrdered, ListChecks, Quote, Minus, Link as LinkIcon, Highlighter,
  Image as ImageIcon, Table as TableIcon, Undo2, Redo2, Palette, Type, Eye, FileCode,
} from 'lucide-react';
import { WikiLink } from '@/modules/notes/WikiLinkExtension';
import { TagHighlight } from '@/modules/notes/TagExtension';
import { cn } from '@/lib/utils';

const lowlight = createLowlight(common);

// ── Custom FontSize extension (extends TextStyle) ───────────────────────────

declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return { types: ['textStyle'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => (element as HTMLElement).style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize as string}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// ── Public types ─────────────────────────────────────────────────────────────

export interface RichTextEditorFeatures {
  wikiLinks?: boolean;
  tagHighlight?: boolean;
  taskList?: boolean;
  typography?: boolean;
  highlight?: boolean;
  link?: boolean;
  /** Replace plain code-block with syntax-highlighted lowlight code-block. */
  codeBlock?: boolean;
  /** Inline images (paste / toolbar insert). */
  image?: boolean;
  /** Markdown-style tables. */
  table?: boolean;
  /** `/` command palette inside the editor. */
  slashMenu?: boolean;
}

export interface RichTextEditorChange {
  content_md: string;
  content_json: string;
}

export interface RichTextEditorProps {
  contentJson?: string;
  contentMd?: string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  minHeight?: number;
  autosaveMs?: number;
  features?: RichTextEditorFeatures;
  /** Render an inline formatting toolbar above the content. */
  showToolbar?: boolean;
  onChange: (v: RichTextEditorChange) => void;
  onWikiLinkClick?: (linkText: string) => void;
  onTagClick?: (tag: string) => void;
  editorRef?: React.MutableRefObject<Editor | null>;
}

// ── Component ────────────────────────────────────────────────────────────────

export function RichTextEditor({
  contentJson,
  contentMd,
  placeholder = 'Start writing…',
  readOnly = false,
  className,
  minHeight = 160,
  autosaveMs = 600,
  features,
  showToolbar = false,
  onChange,
  onWikiLinkClick,
  onTagClick,
  editorRef,
}: RichTextEditorProps): React.ReactElement {
  const f: Required<RichTextEditorFeatures> = {
    wikiLinks: features?.wikiLinks ?? false,
    tagHighlight: features?.tagHighlight ?? false,
    taskList: features?.taskList ?? true,
    typography: features?.typography ?? true,
    highlight: features?.highlight ?? true,
    link: features?.link ?? true,
    codeBlock: features?.codeBlock ?? false,
    image: features?.image ?? false,
    table: features?.table ?? false,
    slashMenu: features?.slashMenu ?? false,
  };

  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const initialContent = React.useMemo<string | object>(() => {
    if (contentJson) {
      try { return JSON.parse(contentJson) as object; } catch { /* noop */ }
    }
    return contentMd ?? '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extensions = React.useMemo<AnyExtension[]>(() => {
    // Disable StarterKit's plain codeBlock when user opts into lowlight version.
    const starter = f.codeBlock
      ? StarterKit.configure({ codeBlock: false })
      : StarterKit;
    const list: AnyExtension[] = [
      starter,
      Placeholder.configure({ placeholder }),
      TextStyle,
      Color.configure({ types: ['textStyle'] }),
      FontSize,
    ];
    if (f.codeBlock) list.push(CodeBlockLowlight.configure({ lowlight }));
    if (f.highlight) list.push(Highlight.configure({ multicolor: true }));
    if (f.link) list.push(Link.configure({ openOnClick: false }));
    if (f.taskList) {
      list.push(TaskList);
      list.push(TaskItem.configure({ nested: true }));
    }
    if (f.typography) list.push(Typography);
    if (f.image) list.push(Image.configure({ inline: false, allowBase64: true }));
    if (f.table) {
      list.push(Table.configure({ resizable: true }));
      list.push(TableRow);
      list.push(TableHeader);
      list.push(TableCell);
    }
    if (f.wikiLinks) {
      list.push(WikiLink.configure({
        onLinkClick(linkText: string) { onWikiLinkClick?.(linkText); },
      }));
    }
    if (f.tagHighlight) {
      list.push(TagHighlight.configure({
        onTagClick(tag: string) { onTagClick?.(tag); },
      }));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = React.useCallback((ed: Editor) => {
    onChangeRef.current({
      content_md: ed.getText({ blockSeparator: '\n\n' }),
      content_json: JSON.stringify(ed.getJSON()),
    });
  }, []);

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable: !readOnly,
    onUpdate({ editor: ed }) {
      if (autosaveMs <= 0) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => emit(ed), autosaveMs);
    },
    onBlur({ editor: ed }) {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      emit(ed);
    },
  });

  React.useEffect(() => {
    if (editorRef) editorRef.current = editor;
    return () => { if (editorRef) editorRef.current = null; };
  }, [editor, editorRef]);

  React.useEffect(() => {
    if (!editor) return;
    if (editor.isEditable === readOnly) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (editor && !editor.isDestroyed) emit(editor);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── Raw HTML mode ────────────────────────────────────────────────────────
  const [rawMode, setRawMode] = React.useState(false);
  const [rawHtml, setRawHtml] = React.useState('');

  const enterRawMode = (): void => {
    if (!editor) return;
    setRawHtml(editor.getHTML());
    setRawMode(true);
  };
  const exitRawMode = (): void => {
    if (!editor) { setRawMode(false); return; }
    editor.commands.setContent(rawHtml, true);
    emit(editor);
    setRawMode(false);
  };
  const toggleRawMode = (): void => {
    if (rawMode) exitRawMode(); else enterRawMode();
  };

  return (
    <div className="flex h-full flex-col">
      {showToolbar && editor && (
        <Toolbar
          editor={editor}
          features={f}
          rawMode={rawMode}
          onToggleRawMode={toggleRawMode}
        />
      )}
      {rawMode ? (
        <textarea
          value={rawHtml}
          onChange={(e) => setRawHtml(e.target.value)}
          spellCheck={false}
          className={cn(
            'flex-1 w-full resize-none rounded-md border-0 bg-muted/40 p-3 font-mono text-xs outline-none',
            className,
          )}
          style={{ minHeight }}
        />
      ) : (
        <div
          className={cn(
            'rich-text-editor prose prose-sm dark:prose-invert max-w-none cursor-text rounded-md p-2 outline-none relative',
            className,
          )}
          style={{ minHeight }}
          onClick={(e) => {
            if (editor && e.target === e.currentTarget) editor.commands.focus('end');
          }}
        >
          <EditorContent editor={editor} />
          {f.slashMenu && editor && <SlashMenu editor={editor} features={f} />}
        </div>
      )}
    </div>
  );
}

export type { Editor };

// ── Toolbar ─────────────────────────────────────────────────────────────────

interface ToolbarProps {
  editor: Editor;
  features: Required<RichTextEditorFeatures>;
  rawMode: boolean;
  onToggleRawMode: () => void;
}

const TEXT_COLORS: ReadonlyArray<{ name: string; value: string | null }> = [
  { name: 'Default', value: null },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Slate', value: '#64748b' },
];

const HIGHLIGHT_COLORS: ReadonlyArray<{ name: string; value: string | null }> = [
  { name: 'None', value: null },
  { name: 'Yellow', value: '#fef08a' },
  { name: 'Green', value: '#bbf7d0' },
  { name: 'Blue', value: '#bfdbfe' },
  { name: 'Pink', value: '#fbcfe8' },
  { name: 'Purple', value: '#e9d5ff' },
  { name: 'Orange', value: '#fed7aa' },
];

const FONT_SIZES: ReadonlyArray<{ label: string; value: string | null }> = [
  { label: 'Default', value: null },
  { label: '12 px', value: '12px' },
  { label: '14 px', value: '14px' },
  { label: '16 px', value: '16px' },
  { label: '18 px', value: '18px' },
  { label: '20 px', value: '20px' },
  { label: '24 px', value: '24px' },
  { label: '28 px', value: '28px' },
  { label: '32 px', value: '32px' },
];

function Toolbar({ editor, features, rawMode, onToggleRawMode }: ToolbarProps): React.ReactElement {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const handler = (): void => force();
    editor.on('selectionUpdate', handler);
    editor.on('transaction', handler);
    return () => {
      editor.off('selectionUpdate', handler);
      editor.off('transaction', handler);
    };
  }, [editor]);

  const insertImage = (): void => {
    const url = window.prompt('Image URL');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };
  const setLink = (): void => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const currentColor = (editor.getAttributes('textStyle').color as string | undefined) ?? null;
  const currentHighlight = (editor.getAttributes('highlight').color as string | undefined) ?? null;
  const currentFontSize = (editor.getAttributes('textStyle').fontSize as string | undefined) ?? null;

  // Raw mode disables most buttons.
  const D = rawMode;

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1 py-1">
      <TBtn label="Bold" disabled={D} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-3.5 w-3.5" /></TBtn>
      <TBtn label="Italic" disabled={D} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-3.5 w-3.5" /></TBtn>
      <TBtn label="Strike" disabled={D} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-3.5 w-3.5" /></TBtn>
      <TBtn label="Inline code" disabled={D} active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><CodeIcon className="h-3.5 w-3.5" /></TBtn>
      <Sep />

      {/* Text color */}
      <ColorMenu
        label="Text color"
        icon={<Palette className="h-3.5 w-3.5" style={{ color: currentColor ?? undefined }} />}
        options={TEXT_COLORS}
        current={currentColor}
        disabled={D}
        onPick={(value) => {
          if (value === null) editor.chain().focus().unsetColor().run();
          else editor.chain().focus().setColor(value).run();
        }}
      />
      {/* Highlight color */}
      {features.highlight && (
        <ColorMenu
          label="Highlight color"
          icon={<Highlighter className="h-3.5 w-3.5" style={{ color: currentHighlight ?? undefined }} />}
          options={HIGHLIGHT_COLORS}
          current={currentHighlight}
          disabled={D}
          onPick={(value) => {
            if (value === null) editor.chain().focus().unsetHighlight().run();
            else editor.chain().focus().setHighlight({ color: value }).run();
          }}
        />
      )}
      {/* Font size */}
      <SizeMenu
        label="Text size"
        icon={<Type className="h-3.5 w-3.5" />}
        current={currentFontSize}
        disabled={D}
        onPick={(value) => {
          if (value === null) editor.chain().focus().unsetFontSize().run();
          else editor.chain().focus().setFontSize(value).run();
        }}
      />
      <Sep />

      <TBtn label="Heading 1" disabled={D} active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-3.5 w-3.5" /></TBtn>
      <TBtn label="Heading 2" disabled={D} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-3.5 w-3.5" /></TBtn>
      <TBtn label="Heading 3" disabled={D} active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-3.5 w-3.5" /></TBtn>
      <Sep />
      <TBtn label="Bullet list" disabled={D} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-3.5 w-3.5" /></TBtn>
      <TBtn label="Numbered list" disabled={D} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-3.5 w-3.5" /></TBtn>
      {features.taskList && (
        <TBtn label="Task list" disabled={D} active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks className="h-3.5 w-3.5" /></TBtn>
      )}
      <TBtn label="Quote" disabled={D} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-3.5 w-3.5" /></TBtn>
      <TBtn label="Code block" disabled={D} active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><CodeIcon className="h-3.5 w-3.5" /></TBtn>
      <TBtn label="Divider" disabled={D} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="h-3.5 w-3.5" /></TBtn>
      <Sep />
      {features.link && <TBtn label="Link" disabled={D} active={editor.isActive('link')} onClick={setLink}><LinkIcon className="h-3.5 w-3.5" /></TBtn>}
      {features.image && <TBtn label="Image" disabled={D} onClick={insertImage}><ImageIcon className="h-3.5 w-3.5" /></TBtn>}
      {features.table && (
        <TBtn label="Table" disabled={D} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="h-3.5 w-3.5" /></TBtn>
      )}
      <Sep />
      <TBtn label="Undo" disabled={D || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-3.5 w-3.5" /></TBtn>
      <TBtn label="Redo" disabled={D || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-3.5 w-3.5" /></TBtn>
      <span className="ml-auto" />
      <TBtn label={rawMode ? 'Preview' : 'Raw HTML'} active={rawMode} onClick={onToggleRawMode}>
        {rawMode ? <Eye className="h-3.5 w-3.5" /> : <FileCode className="h-3.5 w-3.5" />}
      </TBtn>
    </div>
  );
}

// ── Toolbar dropdown helpers ────────────────────────────────────────────────

function ColorMenu({
  label, icon, options, current, onPick, disabled,
}: {
  label: string;
  icon: React.ReactNode;
  options: ReadonlyArray<{ name: string; value: string | null }>;
  current: string | null;
  onPick: (value: string | null) => void;
  disabled?: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const openMenu = (): void => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <>
      <TBtn ref={btnRef} label={label} disabled={disabled} active={open} onClick={openMenu}>
        {icon}
      </TBtn>
      {open && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="grid grid-cols-4 gap-2 rounded-md border border-border bg-popover p-3 shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((opt) => (
            <button
              key={opt.name}
              type="button"
              title={opt.name}
              aria-label={opt.name}
              onClick={() => { onPick(opt.value); setOpen(false); }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded border border-border text-[10px]',
                current === opt.value && 'ring-2 ring-primary ring-offset-1',
              )}
              style={{ background: opt.value ?? 'transparent' }}
            >
              {opt.value === null && <span className="text-muted-foreground">×</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SizeMenu({
  label, icon, current, onPick, disabled,
}: {
  label: string;
  icon: React.ReactNode;
  current: string | null;
  onPick: (value: string | null) => void;
  disabled?: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const openMenu = (): void => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <>
      <TBtn ref={btnRef} label={label} disabled={disabled} active={open} onClick={openMenu}>
        {icon}
      </TBtn>
      {open && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="min-w-[120px] rounded-md border border-border bg-popover p-1 text-xs shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {FONT_SIZES.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => { onPick(opt.value); setOpen(false); }}
              className={cn(
                'flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground',
                current === opt.value && 'bg-accent text-accent-foreground',
              )}
            >
              <span>{opt.label}</span>
              {opt.value && <span className="text-muted-foreground" style={{ fontSize: opt.value }}>A</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const TBtn = React.forwardRef<HTMLButtonElement, {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label: string;
  disabled?: boolean;
}>(function TBtn({ children, onClick, active, label, disabled }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'disabled:opacity-40 disabled:hover:bg-transparent',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </button>
  );
});

function Sep(): React.ReactElement {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
}

// ── Slash menu ──────────────────────────────────────────────────────────────

interface SlashItem {
  key: string;
  label: string;
  hint?: string;
  run: (e: Editor) => void;
  feature?: keyof RichTextEditorFeatures;
}

const SLASH_ITEMS: SlashItem[] = [
  { key: 'h1', label: 'Heading 1', hint: '# ', run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { key: 'h2', label: 'Heading 2', hint: '## ', run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { key: 'h3', label: 'Heading 3', hint: '### ', run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { key: 'list', label: 'Bullet list', hint: '- ', run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: 'ordered', label: 'Numbered list', hint: '1. ', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: 'task', label: 'Task list', hint: '[ ]', feature: 'taskList', run: (e) => e.chain().focus().toggleTaskList().run() },
  { key: 'quote', label: 'Quote', hint: '> ', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: 'code', label: 'Code block', hint: '```', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { key: 'divider', label: 'Divider', hint: '---', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { key: 'table', label: 'Table', feature: 'table', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
];

interface SlashMenuState {
  open: boolean;
  query: string;
  from: number;
  to: number;
  top: number;
  left: number;
}

function SlashMenu({
  editor, features,
}: { editor: Editor; features: Required<RichTextEditorFeatures> }): React.ReactElement | null {
  const [state, setState] = React.useState<SlashMenuState>({
    open: false, query: '', from: 0, to: 0, top: 0, left: 0,
  });
  const [active, setActive] = React.useState(0);

  const items = React.useMemo(
    () => SLASH_ITEMS.filter((it) => !it.feature || features[it.feature]),
    [features],
  );

  const filtered = React.useMemo(() => {
    const q = state.query.toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.label.toLowerCase().includes(q) || it.key.includes(q));
  }, [items, state.query]);

  React.useEffect(() => { setActive(0); }, [state.query]);

  React.useEffect(() => {
    const onUpdate = (): void => {
      const { from, empty } = editor.state.selection;
      if (!empty) { setState((s) => ({ ...s, open: false })); return; }
      const $from = editor.state.selection.$from;
      const lineStart = $from.start();
      const textBefore = editor.state.doc.textBetween(lineStart, from, '\n', '\n');
      const m = /\/(\w*)$/.exec(textBefore);
      if (!m) { setState((s) => ({ ...s, open: false })); return; }
      const slashFrom = from - m[0].length;
      const coords = editor.view.coordsAtPos(slashFrom);
      const containerRect = (editor.view.dom as HTMLElement).getBoundingClientRect();
      setState({
        open: true,
        query: m[1] ?? '',
        from: slashFrom,
        to: from,
        top: coords.bottom - containerRect.top + 4,
        left: coords.left - containerRect.left,
      });
    };
    editor.on('selectionUpdate', onUpdate);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('selectionUpdate', onUpdate);
      editor.off('transaction', onUpdate);
    };
  }, [editor]);

  React.useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[active];
        if (item) applySlash(item);
      } else if (e.key === 'Escape') {
        setState((s) => ({ ...s, open: false }));
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [state.open, filtered, active]);

  function applySlash(item: SlashItem): void {
    editor.chain().focus().deleteRange({ from: state.from, to: state.to }).run();
    item.run(editor);
    setState((s) => ({ ...s, open: false }));
  }

  if (!state.open || filtered.length === 0) return null;
  return (
    <div
      className="absolute z-50 min-w-[180px] rounded-md border border-border bg-popover p-1 text-xs shadow-md"
      style={{ top: state.top, left: state.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {filtered.map((it, i) => (
        <button
          key={it.key}
          type="button"
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left',
            'hover:bg-accent hover:text-accent-foreground',
            i === active && 'bg-accent text-accent-foreground',
          )}
          onMouseEnter={() => setActive(i)}
          onClick={() => applySlash(it)}
        >
          <span>{it.label}</span>
          {it.hint && <span className="text-muted-foreground">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}
