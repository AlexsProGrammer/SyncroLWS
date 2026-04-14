import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface WikiLinkOptions {
  /** Called when user clicks a [[link]] — receives the raw link text */
  onLinkClick?: (linkText: string) => void;
}

const WIKILINK_RE = /\[\[([^\]]+)]]/g;
const pluginKey = new PluginKey('wikiLink');

/**
 * TipTap extension that highlights [[Name]] wiki-link syntax and
 * fires `onLinkClick` when the user clicks one.
 * The raw Markdown is preserved in the document; this extension only
 * adds visual decorations — it does NOT transform the syntax.
 */
export const WikiLink = Extension.create<WikiLinkOptions>({
  name: 'wikiLink',

  addOptions() {
    return { onLinkClick: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: pluginKey,

        // ── Decorations: highlight [[links]] ─────────────────────────────────
        props: {
          decorations(state) {
            const { doc } = state;
            const decorations: Decoration[] = [];

            doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              let match: RegExpExecArray | null;
              WIKILINK_RE.lastIndex = 0;
              while ((match = WIKILINK_RE.exec(node.text)) !== null) {
                const start = pos + match.index;
                const end = start + match[0].length;
                decorations.push(
                  Decoration.inline(start, end, {
                    class: 'wiki-link',
                    'data-wiki-link': match[1],
                  }),
                );
              }
            });

            return DecorationSet.create(doc, decorations);
          },

          // ── Click handler ─────────────────────────────────────────────────
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement;
            if (target.classList.contains('wiki-link')) {
              const linkText = target.getAttribute('data-wiki-link');
              if (linkText && options.onLinkClick) {
                options.onLinkClick(linkText);
                return true; // prevent default
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

export type { Editor };
