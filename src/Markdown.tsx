import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Space } from 'antd';
import { safeImage } from './storage';
import type { Attachment, NoteImage } from './storage';
import { HtmlPreview } from './HtmlPreview';
import { htmlMarker, isHtml } from './html-content';
import type { HtmlStateChange } from './html-content';
import { highlightCode } from './highlight';
import { NoteImage as StoredImage } from './NoteImage';
export const imageMarker = (line: string) => /^!\[[^\]]*\]\(image:([\w-]+)\)$/.exec(line.trim());
export function tableCells(line: string) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')); }
export { copyText } from './clipboard';
function inline(text: string): ReactNode {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|==[^=\n]+==)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('==') && part.endsWith('==')) return <mark key={index}>{part.slice(2, -2)}</mark>;
    return part;
  });
}
function Secret({ value, copied }: { value: string; copied: (text: string) => void }) {
  const [visible, setVisible] = useState(false);
  return <Space size={2}><span className="secret">{visible ? value : '••••••••'}</span><Button size="small" type="text" onClick={() => setVisible(!visible)}>{visible ? '隐藏' : '显示'}</Button><Button size="small" type="text" onClick={() => copied(value)}>复制</Button></Space>;
}
export function Markdown({ body, images = [], htmlFiles = [], onHtmlStateChange, copied }: { body: string; images?: NoteImage[]; htmlFiles?: Attachment[]; onHtmlStateChange?: HtmlStateChange; copied: (text: string) => void }) {
  const lines = body.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  const isTable = (index: number) => lines[index]?.includes('|') && index + 1 < lines.length && tableCells(lines[index + 1]).every(c => /^:?-{3,}:?$/.test(c));
  while (i < lines.length) {
    const line = lines[i], key = i;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++; blocks.push(<pre key={key}><code className="hljs" dangerouslySetInnerHTML={{ __html: highlightCode(code.join('\n'), language) }} /></pre>); continue;
    }
    const html = htmlMarker(line);
    if (html) {
      const file = htmlFiles.find(file => file.id === html[1]);
      blocks.push(file && isHtml(file) ? <HtmlPreview key={key} file={file} onStateChange={onHtmlStateChange} /> : <p key={key}>[HTML 已移除]</p>);
      i++; continue;
    }
    const marker = imageMarker(line);
    if (marker) {
      const image = images.find(img => img.id === marker[1]);
      blocks.push(image && (image.blob || safeImage(image.data)) ? <figure key={key}><StoredImage image={image} /><figcaption>{image.name}</figcaption></figure> : <p key={key}>[图片已移除]</p>);
      i++; continue;
    }
    if (isTable(i)) {
      const heads = tableCells(line), rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(tableCells(lines[i++]));
      blocks.push(<div className="table-wrap" key={key}><table><thead><tr>{heads.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{heads.map((head, c) => <td key={c}>{!row[c] ? '—' : /密码|登录信息|口令|password|secret|token/i.test(head) ? <Secret value={row[c]} copied={copied} /> : /^https?:\/\/\S+$/i.test(row[c]) ? <a href={row[c]} target="_blank" rel="noopener noreferrer">{row[c]}</a> : inline(row[c])}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const heading = /^(#{1,3}) (.*)/.exec(line);
    if (heading) { blocks.push(heading[1].length === 1 ? <h2 key={key}>{inline(heading[2])}</h2> : <h3 key={key}>{inline(heading[2])}</h3>); i++; continue; }
    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !imageMarker(lines[i]) && !htmlMarker(lines[i]) && !isTable(i) && !/^(#{1,3} |```)/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return <article className="markdown">{blocks}</article>;
}
