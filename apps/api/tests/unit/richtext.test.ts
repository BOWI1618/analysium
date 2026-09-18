import { describe, expect, it } from 'vitest';
import { EMPTY_DOC, checklistProgress, collectMentions, docToText, isDocEmpty, sanitizeDoc } from '@flowdesk/contracts';

describe('sanitizeDoc', () => {
  it('keeps allowed nodes and marks', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hello', marks: [{ type: 'bold' }, { type: 'italic' }] }],
        },
      ],
    });
    expect(doc.content?.[0]?.type).toBe('paragraph');
    expect(doc.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }, { type: 'italic' }]);
  });

  it('drops node types that are not on the allow-list', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'safe' }] },
      ],
    });
    expect(doc.content).toHaveLength(1);
    expect(docToText(doc)).toBe('safe');
  });

  it('drops marks that are not on the allow-list', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'onclick' }] }] },
      ],
    });
    expect(doc.content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });

  it('strips javascript: links but keeps safe ones', () => {
    const dangerous = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        },
      ],
    });
    expect(dangerous.content?.[0]?.content?.[0]?.marks).toBeUndefined();

    const safe = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          ],
        },
      ],
    });
    const mark = safe.content?.[0]?.content?.[0]?.marks?.[0];
    expect(mark?.type).toBe('link');
    expect(mark?.attrs?.href).toBe('https://example.com');
    expect(mark?.attrs?.rel).toContain('noopener');
  });

  it('clamps heading levels to the supported range', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 9 }, content: [{ type: 'text', text: 'h' }] }],
    });
    expect(doc.content?.[0]?.attrs?.level).toBe(1);
  });

  it('falls back to an empty document for junk input', () => {
    expect(sanitizeDoc(null)).toEqual(EMPTY_DOC);
    expect(sanitizeDoc('not a doc')).toEqual(EMPTY_DOC);
    expect(sanitizeDoc({ type: 'paragraph' })).toEqual(EMPTY_DOC);
    expect(sanitizeDoc({ type: 'doc', content: [] })).toEqual(EMPTY_DOC);
  });

  it('does not mutate its input', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'script', content: [{ type: 'text', text: 'x' }] }],
    };
    const snapshot = JSON.stringify(input);
    sanitizeDoc(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('docToText', () => {
  it('flattens nested content and renders mentions', () => {
    const text = docToText({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Ping ' }, { type: 'mention', attrs: { id: 'u1', label: 'Мария' } }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'about the bug' }] },
      ],
    });
    expect(text).toContain('Ping @Мария');
    expect(text).toContain('about the bug');
  });
});

describe('collectMentions', () => {
  it('returns each mentioned id once', () => {
    const ids = collectMentions({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u1' } }, { type: 'mention', attrs: { id: 'u2' } }] },
        { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u1' } }] },
      ],
    });
    expect(ids.sort()).toEqual(['u1', 'u2']);
  });

  it('ignores mentions with no id', () => {
    expect(collectMentions({ type: 'doc', content: [{ type: 'mention', attrs: { label: 'x' } }] })).toEqual([]);
  });
});

describe('isDocEmpty', () => {
  it('treats whitespace-only documents as empty', () => {
    expect(isDocEmpty(EMPTY_DOC)).toBe(true);
    expect(isDocEmpty({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(isDocEmpty({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] })).toBe(false);
  });

  it('комментарий из одной картинки не пустой', () => {
    const picture = { type: 'image', attrs: { src: '/api/v1/attachments/a1/content', alt: '' } };
    expect(isDocEmpty({ type: 'doc', content: [picture] })).toBe(false);
    expect(isDocEmpty({ type: 'doc', content: [{ ...picture, attrs: { src: '' } }] })).toBe(true);
  });
});

describe('чек-лист в описании', () => {
  const item = (checked: boolean, nested?: unknown) => ({
    type: 'taskItem',
    attrs: { checked },
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'пункт' }] },
      ...(nested ? [nested] : []),
    ],
  });

  it('считает отмеченные и все пункты, вложенные тоже', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'taskList', content: [item(true), item(false, { type: 'taskList', content: [item(true)] })] },
      ],
    };
    expect(checklistProgress(doc)).toEqual({ done: 2, total: 3 });
  });

  it('без чек-листа — ноль', () => {
    expect(checklistProgress(EMPTY_DOC)).toEqual({ done: 0, total: 0 });
    expect(checklistProgress(null)).toEqual({ done: 0, total: 0 });
  });
});
