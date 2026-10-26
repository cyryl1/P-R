import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { RulesError } from '@/api/types';

export interface YamlEditorHandle {
  /** Move the cursor to a 1-based line and column and focus the editor. */
  jumpTo: (line: number, column?: number) => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  errors: RulesError[];
}

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  '.cm-gutters': {
    backgroundColor: 'hsl(var(--muted))',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'hsl(var(--muted) / 0.5)' },
  '&.cm-focused': { outline: 'none' },
});

/** Map a 1-based line/column to a document offset, clamped to the document. */
function offsetOf(state: EditorState, line: number, column = 1): number {
  const clamped = state.doc.line(Math.min(Math.max(line, 1), state.doc.lines));
  return Math.min(clamped.from + Math.max(column - 1, 0), clamped.to);
}

export function toDiagnostics(
  state: EditorState,
  errors: RulesError[],
): Diagnostic[] {
  return errors.map((error) => {
    const line = state.doc.line(
      Math.min(Math.max(error.line ?? 1, 1), state.doc.lines),
    );
    const from = error.column
      ? offsetOf(state, line.number, error.column)
      : line.from;
    // Underline from the reported column to the end of that token, or the whole line.
    const rest = state.sliceDoc(from, line.to);
    const tokenEnd = error.column
      ? from + (/^[^\s,\]}]+/.exec(rest)?.[0].length ?? 1)
      : line.to;
    return {
      from,
      to: Math.max(tokenEnd, from + (from < line.to ? 1 : 0)),
      severity: 'error',
      message: `${error.path}: ${error.message}`,
    };
  });
}

export const YamlEditor = forwardRef<YamlEditorHandle, Props>(
  function YamlEditor({ value, onChange, errors }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
      if (!host.current) return;
      const editor = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(),
            history(),
            drawSelection(),
            indentOnInput(),
            bracketMatching(),
            highlightActiveLine(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            yaml(),
            theme,
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            EditorView.updateListener.of((update) => {
              if (update.docChanged)
                onChangeRef.current(update.state.doc.toString());
            }),
            EditorView.contentAttributes.of({ 'aria-label': 'Rules YAML' }),
          ],
        }),
      });
      view.current = editor;
      return () => {
        editor.destroy();
        view.current = null;
      };
      // The editor is created once; later value changes are synced below.
      }, []);

    // Sync external value changes (e.g. loading a template or saved text).
    useEffect(() => {
      const editor = view.current;
      if (editor && editor.state.doc.toString() !== value) {
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: value },
        });
      }
    }, [value]);

    useEffect(() => {
      const editor = view.current;
      if (editor)
        editor.dispatch(
          setDiagnostics(editor.state, toDiagnostics(editor.state, errors)),
        );
    }, [errors, value]);

    useImperativeHandle(ref, () => ({
      jumpTo(line, column) {
        const editor = view.current;
        if (!editor) return;
        const pos = offsetOf(editor.state, line, column);
        editor.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        editor.focus();
      },
    }));

    return (
      <div
        ref={host}
        className="h-full min-h-[480px] overflow-hidden rounded-md border border-border"
      />
    );
  },
);
