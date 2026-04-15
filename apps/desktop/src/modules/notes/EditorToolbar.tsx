import React from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  Braces,
  Table,
  Link as LinkIcon,
  Image as ImageIcon,
  FileCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface EditorToolbarProps {
  editor: Editor | null;
  sourceMode: boolean;
  onToggleSource: () => void;
  onInsertImage?: () => void;
}

function ToolbarButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        active && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Divider(): React.ReactElement {
  return <div className="mx-1 h-5 w-px bg-border" />;
}

const ICON_SIZE = 15;

export function EditorToolbar({
  editor,
  sourceMode,
  onToggleSource,
  onInsertImage,
}: EditorToolbarProps): React.ReactElement {
  if (!editor) return <div />;

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border pb-2 mb-2">
      {/* Text formatting */}
      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Ctrl+B)"
      >
        <Bold size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
      >
        <Italic size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <Strikethrough size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline code"
      >
        <Code size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('highlight')}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        title="Highlight"
      >
        <Highlighter size={ICON_SIZE} />
      </ToolbarButton>

      <Divider />

      {/* Headings */}
      <ToolbarButton
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        <Heading1 size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        <Heading2 size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        <Heading3 size={ICON_SIZE} />
      </ToolbarButton>

      <Divider />

      {/* Lists */}
      <ToolbarButton
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        <List size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Ordered list"
      >
        <ListOrdered size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="Task list"
      >
        <ListChecks size={ICON_SIZE} />
      </ToolbarButton>

      <Divider />

      {/* Block elements */}
      <ToolbarButton
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Blockquote"
      >
        <Quote size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="Code block"
      >
        <Braces size={ICON_SIZE} />
      </ToolbarButton>
      <ToolbarButton
        active={false}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        <Minus size={ICON_SIZE} />
      </ToolbarButton>

      <Divider />

      {/* Table */}
      <ToolbarButton
        active={editor.isActive('table')}
        onClick={() => {
          if (editor.isActive('table')) {
            editor.chain().focus().deleteTable().run();
          } else {
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          }
        }}
        title="Insert/remove table"
      >
        <Table size={ICON_SIZE} />
      </ToolbarButton>

      {/* Image */}
      <ToolbarButton
        active={false}
        onClick={() => {
          if (onInsertImage) {
            onInsertImage();
          } else {
            const url = window.prompt('Image URL:');
            if (url) editor.chain().focus().setImage({ src: url }).run();
          }
        }}
        title="Insert image"
      >
        <ImageIcon size={ICON_SIZE} />
      </ToolbarButton>

      {/* Link */}
      <ToolbarButton
        active={editor.isActive('link')}
        onClick={() => {
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run();
          } else {
            const url = window.prompt('Link URL:');
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }
        }}
        title="Insert/remove link"
      >
        <LinkIcon size={ICON_SIZE} />
      </ToolbarButton>

      <div className="ml-auto" />

      {/* Source mode toggle */}
      <ToolbarButton active={sourceMode} onClick={onToggleSource} title="Toggle source view">
        <FileCode size={ICON_SIZE} />
      </ToolbarButton>
    </div>
  );
}
