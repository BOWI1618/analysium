import type { Editor } from '@tiptap/react';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { canSplit } from '@tiptap/pm/transform';

const LIST_ITEMS = { bulletList: 'listItem', orderedList: 'listItem', taskList: 'taskItem' } as const;
type ListType = keyof typeof LIST_ITEMS;
type BlockFormat = ListType | 'heading' | 'blockquote' | 'codeBlock';

/** Block formatting operates on paragraphs. Promote soft breaks in the touched
 * paragraphs to block boundaries so a pasted group of lines can be formatted
 * line by line, while keeping the inline content and selection in place. */
function splitSoftLines(tr: Transaction) {
  const selection = tr.selection;
  const { from, to, anchor, head } = selection;
  const breaks: number[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return;
    node.forEach((child, offset) => {
      if (child.type.name === 'hardBreak') breaks.push(pos + 1 + offset);
    });
    return false;
  });
  let nextAnchor = anchor;
  let nextHead = head;
  for (const pos of breaks.reverse()) {
    if (!canSplit(tr.doc, pos)) continue;
    tr.delete(pos, pos + 1).split(pos);
    if (nextAnchor > pos) nextAnchor += 1;
    if (nextHead > pos) nextHead += 1;
  }
  if (breaks.length && selection instanceof TextSelection) {
    tr.setSelection(TextSelection.create(tr.doc, nextAnchor, nextHead));
  }
}

export function formatRichTextLines(editor: Editor, format: BlockFormat) {
  const chain = editor.chain().focus().command(({ tr }) => {
    splitSoftLines(tr);
    return true;
  });

  if (format === 'heading') return chain.toggleHeading({ level: 2 }).run();
  if (format === 'blockquote') return chain.toggleBlockquote().run();
  if (format === 'codeBlock') return chain.toggleCodeBlock().run();

  return chain.command(({ tr, commands }) => {
    const { $from, $to } = tr.selection;
    // The default list switch can change the entire surrounding list. Lift the
    // selected items first so their neighbours keep the original list format.
    for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
      const name = $from.node(depth).type.name;
      if (!(name in LIST_ITEMS)) continue;
      if (name !== format && depth <= $to.depth && $from.start(depth) === $to.start(depth)) {
        commands.liftListItem(LIST_ITEMS[name as ListType]);
      }
      break;
    }
    return true;
  }).toggleList(format, LIST_ITEMS[format]).run();
}
