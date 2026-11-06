import { useState } from 'react';
import { App, Button, Modal, Space } from 'antd';
import { assetBytes } from './storage';
import type { Attachment } from './storage';
import { isHtml } from './html-content';
import type { HtmlStateChange } from './html-content';
import { HtmlPreview } from './HtmlPreview';
function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function Attachments({ files, onRemove, onInsertHtml, onHtmlStateChange, disabled }: { files: Attachment[]; onRemove?: (id: string) => void; onInsertHtml?: (id: string) => void; onHtmlStateChange?: HtmlStateChange; disabled?: boolean }) {
  const { message } = App.useApp();
  const [previewId, setPreviewId] = useState<string>();
  const previewFile = files.find(file => file.id === previewId);
  async function download(file: Attachment) {
    try {
      const url = URL.createObjectURL(new Blob([await assetBytes(file)], { type: 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { void message.error('下载失败，请重试。'); }
  }
  return <div className="attachments">{files.map(file => <div className="attachment-row" key={file.id}><span aria-hidden="true">📎</span><div className="attachment-info"><span title={file.name}>{file.name}</span><small>{sizeLabel(file.size)}</small></div><Space size={4}>{isHtml(file) && <><Button size="small" onClick={() => setPreviewId(file.id)}>预览</Button>{onInsertHtml && <Button size="small" disabled={disabled} onClick={() => onInsertHtml(file.id)}>插入正文</Button>}</>}<Button size="small" disabled={disabled} onClick={() => void download(file)}>下载</Button>{onRemove && <Button size="small" danger disabled={disabled} onClick={() => onRemove(file.id)}>移除</Button>}</Space></div>)}<Modal title={previewFile?.name || 'HTML'} open={!!previewFile} onCancel={() => setPreviewId(undefined)} footer={null} width="95vw" destroyOnHidden>{previewFile && <HtmlPreview full file={previewFile} onStateChange={onHtmlStateChange} />}</Modal></div>;
}
