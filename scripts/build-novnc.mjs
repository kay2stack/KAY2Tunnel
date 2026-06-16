// Build a self-contained noVNC RFB bundle for vendor/novnc.js
import * as esbuild from 'esbuild';

await esbuild.build({
  stdin: {
    contents: `
import RFB from '@novnc/novnc';
window.RFB = RFB;
`,
    loader: 'js',
    resolveDir: '/home/kay2/KAY2Tunnel/node_modules',
  },
  bundle: true,
  format: 'esm',
  outfile: '/home/kay2/KAY2Tunnel/public/vendor/novnc.js',
  minify: true,
  target: ['chrome100', 'safari15', 'firefox100'],
});

console.log('Built vendor/novnc.js');
