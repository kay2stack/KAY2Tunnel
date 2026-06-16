// Build a self-contained CM6 browser bundle for vendor/codemirror.js
import * as esbuild from 'esbuild';

await esbuild.build({
  stdin: {
    contents: `
import { EditorView, keymap, highlightActiveLine, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { foldGutter, indentOnInput, bracketMatching, foldKeymap } from '@codemirror/language';
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

window.CM = {
  EditorView, EditorState, Compartment, keymap,
  highlightActiveLine, lineNumbers, highlightActiveLineGutter,
  defaultKeymap, history, historyKeymap, indentWithTab,
  foldGutter, indentOnInput, bracketMatching, foldKeymap,
  closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap,
  searchKeymap, highlightSelectionMatches,
  oneDark,
  langs: { javascript, python, json, css, html, markdown },
};
`,
    loader: 'js',
    resolveDir: '/home/kay2/KAY2Tunnel/node_modules',
  },
  bundle: true,
  format: 'iife',
  outfile: '/home/kay2/KAY2Tunnel/public/vendor/codemirror.js',
  minify: true,
});

console.log('Built vendor/codemirror.js');
