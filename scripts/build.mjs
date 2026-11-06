import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { embeddedAssetsPlugin } from './embedded-assets.mjs';
const result = await build({
  plugins: [embeddedAssetsPlugin], entryPoints: ['src/main.tsx'], bundle: true, write: false,
  outfile: 'dist/app.js', format: 'iife', target: 'es2022',
  jsx: 'automatic', minify: true, legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = result.outputFiles.find(f => f.path.endsWith('.css'))?.text || '';
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src blob:; base-uri 'none'; form-action 'none'"><title>mynote</title><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
console.log(`Built dist/index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB), standalone and offline.`);

const extension = 'dist/chrome-extension';
await cp('extension', extension, { recursive: true });
await Promise.all([
  writeFile(`${extension}/app.js`, js),
  writeFile(`${extension}/app.css`, css),
  writeFile(`${extension}/index.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mynote</title><link rel="stylesheet" href="app.css"><script src="app.js" defer></script></head><body><div id="root"></div></body></html>'),
]);
console.log(`Built ${extension} (Chrome Manifest V3).`);
