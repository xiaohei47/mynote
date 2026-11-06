import { useEffect, useRef, useState } from 'react';
import { App, Button, Modal } from 'antd';
import type { Attachment, HtmlState } from './storage';
import { validateHtmlState, assetBytes, bytes64 } from './storage';
import { copyText } from './clipboard';
import { prepareHtml } from './html-content';
import type { HtmlStateChange } from './html-content';

const isExtension = location.protocol === 'chrome-extension:';

function HtmlFrame({ file, onStateChange }: { file: Attachment; onStateChange?: HtmlStateChange }) {
  const [preview, setPreview] = useState<{ url: string; html?: string }>(), [failure, setFailure] = useState('');
  const { message, modal } = App.useApp();
  const callbacks = useRef({ file, onStateChange });
  const port = useRef<MessagePort | null>(null);
  callbacks.current = { file, onStateChange };
  useEffect(() => {
    let active = true, next = ''; setPreview(undefined); setFailure('');
    void (async () => {
      const loaded = file.blob ? { ...file, data: bytes64(await assetBytes(file)) } : file;
      if (!active) return;
      const html = prepareHtml(loaded);
      if (isExtension) {
        setPreview({ url: 'preview.html', html });
      } else {
        next = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        setPreview({ url: next });
      }
    })().catch(() => { if (active) setFailure('HTML 读取失败，请刷新重试。'); });
    return () => { active = false; if (next) URL.revokeObjectURL(next); port.current?.close(); };
  }, [file.id, file.data, file.blob]);
  function connect(frame: HTMLIFrameElement) {
    port.current?.close();
    const channel = new MessageChannel(); port.current = channel.port1;
    channel.port1.onmessage = async event => {
      const { id, method, payload } = event.data || {};
      if (!Number.isSafeInteger(id)) return;
      try {
        let value: unknown;
        if (method === 'save-tasks') {
          const state: HtmlState = { tasks: payload?.tasks, revision: crypto.randomUUID() }; validateHtmlState(state);
          if (!callbacks.current.onStateChange) throw Error('请先编辑笔记后再修改待办。');
          await callbacks.current.onStateChange(callbacks.current.file.id, state, payload?.expectedRevision);
          value = state;
        } else if (method === 'alert') {
          if (typeof payload !== 'string' || payload.length > 3000) throw Error('提示内容过长。');
          void message.info(payload);
        } else if (method === 'confirm') {
          if (typeof payload !== 'string' || payload.length > 3000) throw Error('提示内容过长。');
          value = await new Promise<boolean>(resolve => { modal.confirm({ title: payload, okText: '确定', cancelText: '取消', onOk: () => resolve(true), onCancel: () => resolve(false) }); });
        } else if (method === 'copy') {
          if (typeof payload !== 'string' || payload.length > 100000 || !navigator.userActivation.isActive) throw Error('请点击复制按钮。');
          await copyText(payload);
        } else if (method === 'open') {
          if (typeof payload !== 'string' || payload.length > 100000 || !navigator.userActivation.isActive) throw Error('请点击页面中的登录按钮。');
          const target = new URL(payload);
          if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw Error('不支持这个链接。');
          window.open(target.href, '_blank', 'noopener,noreferrer');
        } else throw Error('不支持的操作。');
        channel.port1.postMessage({ id, value });
      } catch (error) { const text = error instanceof Error ? error.message : '操作失败。'; void message.error(text); channel.port1.postMessage({ id, error: text }); }
    };
    frame.contentWindow?.postMessage({
      type: isExtension ? 'shiye-preview-render' : 'shiye-html-init',
      html: preview?.html,
      state: callbacks.current.file.htmlState,
    }, '*', [channel.port2]);
  }
  return preview ? <iframe className="html-frame" src={preview.url} title={file.name} sandbox="allow-scripts allow-modals allow-downloads" referrerPolicy="no-referrer" onLoad={event => connect(event.currentTarget)} /> : failure ? <p>{failure}</p> : null;
}
export function HtmlPreview({ file, onStateChange, full = false }: { file: Attachment; onStateChange?: HtmlStateChange; full?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (full) return <div className="html-preview-full"><HtmlFrame file={file} onStateChange={onStateChange} /></div>;
  return <section className="html-preview"><div className="html-preview-toolbar"><span>{file.name}</span><Button size="small" onClick={() => setExpanded(true)}>放大</Button></div>{!expanded && <HtmlFrame file={file} onStateChange={onStateChange} />}<Modal title={file.name} open={expanded} onCancel={() => setExpanded(false)} footer={null} width="96vw" destroyOnHidden className="html-preview-modal">{expanded && <HtmlFrame file={file} onStateChange={onStateChange} />}</Modal></section>;
}
