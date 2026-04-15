export interface NoteTemplate {
  id: string;
  name: string;
  getTitle: () => string;
  getContent: () => object;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'meeting',
    name: 'Meeting Notes',
    getTitle: () => 'Meeting Notes',
    getContent: () => ({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Meeting Notes' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Date: ' },
            { type: 'text', text: new Date().toLocaleDateString() },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Attendees: ' },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Agenda' }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Topic 1' }] },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Topic 2' }] },
              ],
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Discussion Notes' }],
        },
        { type: 'paragraph' },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Action Items' }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Action item' }] },
              ],
            },
          ],
        },
      ],
    }),
  },
  {
    id: 'daily',
    name: 'Daily Log',
    getTitle: () => `Daily Log — ${new Date().toLocaleDateString()}`,
    getContent: () => ({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: `Daily Log — ${new Date().toLocaleDateString()}` },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Goals for Today' }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Goal 1' }] },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Goal 2' }] },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Goal 3' }] },
              ],
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Work Log' }],
        },
        { type: 'paragraph' },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Reflection' }],
        },
        { type: 'paragraph' },
      ],
    }),
  },
];
