import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface TagHighlightOptions {
  onTagClick?: (tag: string) => void;
}

const TAG_RE = /#([a-zA-Z][\w-]*)/g;
const pluginKey = new PluginKey('tagHighlight');

/**
 * TipTap extension that highlights inline #tag syntax and
 * fires `onTagClick` when the user clicks one.
 */
export const TagHighlight = Extension.create<TagHighlightOptions>({
  name: 'tagHighlight',

  addOptions() {
    return { onTagClick: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: pluginKey,

        props: {
          decorations(state) {
            const { doc } = state;
            const decorations: Decoration[] = [];

            doc.descendants((node, pos) => {
              // Skip code blocks entirely
              if (node.type.name === 'codeBlock') return false;
              if (!node.isText || !node.text) return;
              // Skip text with inline code mark
              if (node.marks.some((m) => m.type.name === 'code')) return;

              let match: RegExpExecArray | null;
              TAG_RE.lastIndex = 0;
              while ((match = TAG_RE.exec(node.text)) !== null) {
                const start = pos + match.index;
                const end = start + match[0].length;
                decorations.push(
                  Decoration.inline(start, end, {
                    class: 'note-tag',
                    'data-tag': match[1],
                  }),
                );
              }
            });

            return DecorationSet.create(doc, decorations);
          },

          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement;
            if (target.classList.contains('note-tag')) {
              const tag = target.getAttribute('data-tag');
              if (tag && options.onTagClick) {
                options.onTagClick(tag);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
