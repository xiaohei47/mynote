import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
hljs.registerLanguage('powershell', powershell);
function escapeHtml(source: string): string {
  return source.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
export function highlightCode(source: string, language: string): string {
  const name = language.trim().split(/\s+/)[0].toLowerCase();
  if (!name) return hljs.highlightAuto(source).value;
  if (!hljs.getLanguage(name)) return escapeHtml(source);
  return hljs.highlight(source, { language: name, ignoreIllegals: true }).value;
}
