import { attachmentBytes } from './storage';
import type { Attachment, HtmlState } from './storage';
import { htmlRuntime } from './html-runtime';
import xlsxSource from 'shiye:html-xlsx';
export type HtmlStateChange = (id: string, state: HtmlState, expectedRevision?: string) => Promise<void>;
export const htmlMarker = (line: string) => /^!\[HTML\]\(html:([\w-]+)\)$/.exec(line.trim());
export function isHtml(file: Pick<Attachment, 'name' | 'type'>): boolean { return /\.html?$/i.test(file.name) || file.type.toLowerCase().split(';')[0] === 'text/html'; }
export function decodeHtml(file: Attachment): string {
  const bytes = attachmentBytes(file);
  const prefix = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const encoding = /<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i.exec(prefix)?.[1] || 'utf-8';
  try { return new TextDecoder(encoding).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}
export function prepareHtml(file: Attachment): string {
  const document = new DOMParser().parseFromString(decodeHtml(file), 'text/html');
  document.querySelectorAll('base,meta[http-equiv],iframe,object,embed').forEach(node => node.remove());
  document.querySelectorAll('script[src]').forEach(node => {
    const src = node.getAttribute('src') || '';
    if (src === 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js') { node.removeAttribute('src'); node.textContent = xlsxSource; }
    else node.remove();
  });
  const charset = document.createElement('meta'); charset.setAttribute('charset', 'UTF-8');
  const policy = document.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const runtime = document.createElement('script'); runtime.textContent = `(${htmlRuntime.toString()})();`;
  document.head.prepend(charset, policy, runtime);
  document.querySelectorAll('script:not([src])').forEach(node => { node.textContent = (node.textContent || '').replace(/<\/script/gi, '<\\/script'); });
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}
