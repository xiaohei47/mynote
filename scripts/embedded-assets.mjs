import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const embeddedAssetsPlugin = {
  name: 'embedded-html-assets',
  setup(build) {
    build.onResolve({ filter: /^shiye:html-xlsx$/ }, () => ({ path: 'html-xlsx', namespace: 'shiye-html' }));
    build.onLoad({ filter: /.*/, namespace: 'shiye-html' }, async () => ({ contents: `export default ${JSON.stringify(await readFile(require.resolve('xlsx/dist/xlsx.full.min.js'), 'utf8'))}`, loader: 'js' }));
  },
};
