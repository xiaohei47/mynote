import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, App as AntApp, Button, ConfigProvider, Empty, Input, Modal, Popconfirm, Select, Space, Spin, Tag, Typography, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { bytes64, compareNotes, saveVault, migrateVault, materialize, lockAssets, forgetUnlock, loadEnvelope, MAX_BYTES, newVault, openStorageDirectory, prepareStorage, readAttachment, recallUnlock, rememberUnlock, seal, transferredFiles, unlock, unlockWithKey, validateEnvelope } from './storage';
import type { Attachment, Envelope, HtmlState, Note, NoteImage, Vault } from './storage';
import { copyText, imageMarker, Markdown } from './Markdown';
import { Attachments } from './Attachments';
import { NoteImage as StoredImage } from './NoteImage';
import { isDirty, updateDrafts } from './drafts';
import { htmlMarker, isHtml } from './html-content';
import 'antd/dist/reset.css';
import './style.css';
import { applyTheme, readTheme, themes } from './themes';
import type { ThemeName } from './themes';

type Session = { key: CryptoKey; envelope: Envelope; vault: Vault };
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const date = (text: string) => new Date(text).toLocaleDateString('zh-CN');
function download(envelope: Envelope) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `mynote备份-${new Date().toISOString().slice(0, 10)}.shiye`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function pickBackup(file: File): Promise<Envelope> {
  if (file.size > MAX_BYTES * 1.4 + 4096) throw Error('备份文件过大。');
  const value: unknown = JSON.parse(await file.text()); validateEnvelope(value); if (value.format) throw Error('请选择导出的加密备份，不要选择目录索引。'); return value;
}
async function readImage(file: File): Promise<NoteImage> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw Error('请选择 PNG、JPG、WebP 或 GIF 图片。');
  if (file.size > 5 * 1024 * 1024) throw Error('单张图片不能超过 5 MB。');
  const data = `data:${file.type};base64,${bytes64(new Uint8Array(await file.arrayBuffer()))}`;
  const image = new window.Image(); image.src = data;
  try { await image.decode(); } catch { throw Error('图片文件无法打开。'); }
  return { id: crypto.randomUUID(), name: file.name || '粘贴的截图.png', data };
}
function Shiye({ themeName, onThemeChange }: { themeName: ThemeName; onThemeChange: (name: ThemeName) => void }) {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(true), [failure, setFailure] = useState('');
  const [directoryReady, setDirectoryReady] = useState(false), [canResumeDirectory, setCanResumeDirectory] = useState(false);
  const [stored, setStored] = useState<Envelope>(), [session, setSession] = useState<Session>();
  const [password, setPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false), [selected, setSelected] = useState<string>();
  const [draftState, dispatchDraft] = useReducer(updateDrafts, { notes: new Map<string, Note>() });
  const draft = draftState.notes.get(draftState.activeId || '') || null;
  const [query, setQuery] = useState(''), [tag, setTag] = useState('');
  function setDraft(value: Note | null) { dispatchDraft(value ? { type: 'edit', note: value } : { type: 'close' }); }
  const dirtyIds = new Set([...draftState.notes.values()].filter(note => isDirty(note, session?.vault.notes.find(saved => saved.id === note.id))).map(note => note.id));
  const [incoming, setIncoming] = useState<Envelope>(), [backupPassword, setBackupPassword] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false), [preview, setPreview] = useState(false);
  const [imagesExpanded, setImagesExpanded] = useState(false);
  const draftRef = useRef(draft);
  useLayoutEffect(() => { draftRef.current = draft; }, [draft]);
  async function loadCurrentVault() {
    const envelope = await loadEnvelope(); setStored(envelope); setSession(undefined);
    if (envelope) {
      const recalled = await recallUnlock(envelope).catch(() => undefined);
      if (recalled) { const next = await migrateVault(recalled.vault, recalled.key, envelope); setStored(next.envelope); setSession(next); setSelected(next.vault.notes[0]?.id); }
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        const status = await prepareStorage(); setCanResumeDirectory(status.canResume);
        if (status.ready) { await loadCurrentVault(); setDirectoryReady(true); }
      } catch (e) { setFailure(errorText(e)); } finally { setLoading(false); }
    })();
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtyIds.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyIds.size]);
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (e) { void message.error(errorText(e)); } finally { setBusy(false); } };
  async function openDirectory(chooseNew = false) {
    await run(async () => {
      if (!await openStorageDirectory(chooseNew)) return;
      await loadCurrentVault(); setDirectoryReady(true); setFailure('');
    });
  }
  async function authenticate() {
    await run(async () => {
      let next: Session;
      if (stored) { const opened = await unlock(stored, password); next = await migrateVault(opened.vault, opened.key, stored); setStored(next.envelope); }
      else if (incoming) { const opened = await unlock(incoming, password); next = await migrateVault(opened.vault, opened.key, incoming); setStored(next.envelope); setIncoming(undefined); }
      else { if (password !== confirmPassword) throw Error('两次输入的密码不一致。'); next = await newVault(password); setStored(next.envelope); }
      await rememberUnlock(next.envelope, next.key).catch(() => { void message.warning('已解锁，但浏览器无法记住登录，下次需要重新输入密码。'); });
      setSession(next); setSelected(next.vault.notes[0]?.id); setPassword(''); setConfirmPassword('');
      if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
    });
  }
  async function save(notes: Note[]): Promise<void> {
    if (!session) throw Error('请先解锁资料库。');
    const { vault, envelope } = await saveVault({ notes }, session.key, session.envelope.salt, session.envelope.iterations, session.envelope.revision);
    setSession({ ...session, vault, envelope }); setStored(envelope);
  }
  async function saveHtmlState(id: string, state: HtmlState, expectedRevision?: string) {
    if (busy) throw Error('正在保存，请稍后重试。');
    function update(note: Note): Note {
      const file = note.attachments?.find(file => file.id === id);
      if (!file) throw Error('HTML 已移除。');
      if (file.htmlState?.revision !== expectedRevision) throw Error('HTML 已在其他预览中更新，请重新打开预览。');
      return { ...note, attachments: note.attachments?.map(file => file.id === id ? { ...file, htmlState: state } : file), updated: new Date().toISOString() };
    }
    const editing = draftRef.current;
    if (editing) { const next = update(editing); draftRef.current = next; setDraft(next); return; }
    if (!session || !selected) throw Error('请先解锁资料库。');
    setBusy(true);
    try {
      const envelope = await loadEnvelope();
      if (!envelope || envelope.salt !== session.envelope.salt || envelope.iterations !== session.envelope.iterations) throw Error('资料库已更换，请重新解锁。');
      const current = await unlockWithKey(envelope, session.key);
      if (!current.vault.notes.some(note => note.id === selected)) throw Error('笔记已移除。');
      const vault = { ...current.vault, notes: current.vault.notes.map(note => note.id === selected ? update(note) : note) };
      const saved = await saveVault(vault, session.key, envelope.salt, envelope.iterations, envelope.revision);
      setSession({ key: session.key, ...saved }); setStored(saved.envelope);
    } finally { setBusy(false); }
  }
  function insertHtml(id: string) {
    if (!draft) return;
    const input = document.getElementById('note-body') as HTMLTextAreaElement | null;
    const start = input?.selectionStart ?? draft.body.length, end = input?.selectionEnd ?? start;
    setDraft({ ...draft, body: draft.body.slice(0, start) + `\n\n![HTML](html:${id})\n\n` + draft.body.slice(end) });
  }
  function leave(action: () => void) {
    if (busy) return;
    action();
  }
  function edit(note?: Note) {
    leave(() => {
      setImagesExpanded(false);
      const now = new Date().toISOString();
      const next = note ? draftState.notes.get(note.id) || { ...note } : { id: crypto.randomUUID(), title: '', tag: '', body: '', images: [], attachments: [], created: now, updated: now };
      setDraft(next); setSelected(next.id); setTag(''); setQuery('');
    });
  }
  async function addFiles(files: File[], imagesOnly = false) {
    if (!draft || !files.length) return;
    const target = document.getElementById('note-body') as HTMLTextAreaElement | null;
    const start = target?.selectionStart ?? draft.body.length, end = target?.selectionEnd ?? start;
    await run(async () => {
      const images: NoteImage[] = [], attachments: Attachment[] = [];
      for (const file of files) {
        if (imagesOnly) { images.push(await readImage(file)); continue; }
        if (/^image\/(png|jpeg|webp|gif)$/.test(file.type) && file.size <= 5 * 1024 * 1024) {
          try { images.push(await readImage(file)); continue; } catch {}
        }
        attachments.push(await readAttachment(file));
      }
      const blocks = [...images.map(img => `![图片](image:${img.id})`), ...attachments.filter(isHtml).map(file => `![HTML](html:${file.id})`)];
      const markers = blocks.length ? '\n\n' + blocks.join('\n\n') + '\n\n' : '';
      const next = { ...draft, images: [...(draft.images || []), ...images], attachments: [...(draft.attachments || []), ...attachments], body: markers ? draft.body.slice(0, start) + markers + draft.body.slice(end) : draft.body };
      const projected = { notes: [...(session?.vault.notes || []).filter(n => n.id !== draft.id), next] };
      if (new Blob([JSON.stringify(projected)]).size > MAX_BYTES) throw Error('资料库超过 100 MB，请减少文件。');
      setDraft(next);
    });
  }
  async function copied(text: string) { try { await copyText(text); void message.success('已复制。'); } catch (e) { void message.error(errorText(e)); } }
  async function importBackup(file: File) { try { const value = await pickBackup(file); setIncoming(value); setBackupPassword(''); } catch (e) { void message.error(errorText(e)); } }
  async function restore() {
    await run(async () => {
      if (!incoming || !session) return;
      const imported = await unlock(incoming, backupPassword);
      const notes = [...session.vault.notes];
      const existingContent = (await materialize(session.vault)).notes;
      for (const note of (await materialize(imported.vault)).notes) {
        const existing = notes.find(n => n.id === note.id);
        if (!existing) notes.push(note);
        else if (JSON.stringify(existingContent.find(n => n.id === note.id)) !== JSON.stringify(note)) notes.push({ ...note, id: crypto.randomUUID(), title: `${note.title}（导入）` });
      }
      await save(notes); setIncoming(undefined); setBackupPassword(''); void message.success('已导入。');
    });
  }
  const themePicker = <Select<ThemeName> aria-label="主题" value={themeName} onChange={onThemeChange} options={Object.entries(themes).map(([value, config]) => ({ value: value as ThemeName, label: config.label }))} popupMatchSelectWidth={false} className="theme-picker" />;
  const backupPicker = <label className="file-button"><input aria-label="选择加密备份" type="file" accept=".shiye,application/json" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importBackup(f); }} /><span>↑ 导入备份</span></label>;
  if (loading) return <div className="auth"><Spin tip="打开资料库…"><div style={{ height: 80 }} /></Spin></div>;
  if (failure) return <div className="auth"><div className="auth-card"><Alert title="无法打开数据库" description={failure} type="error" showIcon />{typeof window.showDirectoryPicker === 'function' && <Button block style={{ marginTop: 20 }} loading={busy} onClick={() => void openDirectory(true)}>重新选择目录</Button>}</div></div>;
  if (!directoryReady) return <div className="auth"><div className="auth-card"><div className="auth-brand"><div className="mark">m</div>{themePicker}</div><Typography.Title level={2}>mynote</Typography.Title><Typography.Title level={4}>资料目录</Typography.Title><Button block type="primary" loading={busy} onClick={() => void openDirectory()}>{canResumeDirectory ? '授权并打开' : '选择 .shiye 文件夹'}</Button>{canResumeDirectory && <Button block type="text" disabled={busy} style={{ marginTop: 12 }} onClick={() => void openDirectory(true)}>重新选择目录</Button>}</div></div>;
  if (!session) return <div className="auth"><div className="auth-card"><div className="auth-brand"><div className="mark">m</div>{themePicker}</div><Typography.Title level={2}>mynote</Typography.Title><Typography.Title level={4}>{stored || incoming ? '解锁资料库' : '创建资料库'}</Typography.Title><form onSubmit={e => { e.preventDefault(); void authenticate(); }}><Input.Password aria-label="资料库密码" placeholder={stored || incoming ? '密码' : '密码（至少 8 位）'} value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete={stored || incoming ? 'current-password' : 'new-password'} />{!stored && !incoming && <Input.Password aria-label="确认密码" placeholder="确认密码" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />}<Button block type="primary" htmlType="submit" loading={busy}>{stored || incoming ? '解锁' : '创建资料库'}</Button></form>{!stored && backupPicker}{incoming && !stored && <Button type="link" onClick={() => setIncoming(undefined)}>取消导入</Button>}</div></div>;
  const notes = session.vault.notes;
  const current = notes.find(n => n.id === selected);
  const tags = [...new Set(notes.map(n => n.tag).filter(Boolean))].sort();
  const listed = [...notes.map(note => draftState.notes.get(note.id) || note), ...[...draftState.notes.values()].filter(note => !notes.some(saved => saved.id === note.id))];
  const visible = listed.filter(n => (!tag || n.tag === tag) && [n.title, n.body, n.tag, ...(n.attachments || []).map(file => file.name)].join(' ').toLowerCase().includes(query.toLowerCase())).sort(compareNotes);
  return <div className="shell"><div className={`workspace${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}><button className="sidebar-handle" type="button" aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} aria-expanded={!sidebarCollapsed} aria-controls="note-sidebar" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>{!sidebarCollapsed && <section className="note-list" id="note-sidebar"><div className="list-heading">{themePicker}<Button onClick={() => leave(() => { void run(async () => { await forgetUnlock(); for (const id of draftState.notes.keys()) if (!dirtyIds.has(id)) dispatchDraft({ type: 'remove', id }); lockAssets(); setDraft(null); setSession(undefined); }); })} disabled={busy}>锁定</Button><Button type="primary" onClick={() => edit()} disabled={busy}>＋ 新建</Button></div>{(tags.length > 0 || !!tag) && <Select aria-label="标签筛选" className="note-filter" value={tag} onChange={setTag} options={[{ value: '', label: '全部标签' }, ...tags.map(t => ({ value: t, label: t }))]} />}<Input.Search aria-label="搜索笔记" placeholder="搜索…" value={query} onChange={e => setQuery(e.target.value)} allowClear />{visible.length ? <div className="cards">{visible.map(n => <div className="note-card-container" key={n.id}><button disabled={busy} className={`note-card ${selected === n.id ? 'active' : ''}`} onClick={() => leave(() => { dispatchDraft({ type: 'select', id: n.id }); setImagesExpanded(false); setSelected(n.id); })}><h3><span className="note-card-title">{n.title || '未命名'}</span>{dirtyIds.has(n.id) && <span className="unsaved-dot" role="img" aria-label="未保存" title="未保存" />}</h3><p>{n.body.split('\n').find(l => l.trim() && !l.includes('|') && !imageMarker(l) && !htmlMarker(l)) || (n.images?.length ? '图片资料' : n.attachments?.[0]?.name || '表格资料')}</p><div><Tag>{n.tag || '未分类'}</Tag><small>{date(n.updated)}</small></div></button><button type="button" className={`note-pin${n.pinned ? ' pinned' : ''}`} aria-label={`${n.pinned ? '取消置顶' : '置顶'}：${n.title}`} title={n.pinned ? '取消置顶' : '置顶'} aria-pressed={!!n.pinned} disabled={busy} onClick={() => void run(async () => { const pinned = !n.pinned; if (notes.some(note => note.id === n.id)) await save(notes.map(note => note.id === n.id ? { ...note, pinned } : note)); dispatchDraft({ type: 'pin', id: n.id, pinned }); })}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 9V3H8v6l-3 3v3h14v-3l-3-3Z" fill={n.pinned ? 'currentColor' : 'none'} /><path d="M12 15v7" /></svg></button></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配笔记" />}<div className="note-backups"><Button block onClick={() => void run(async () => { const vault = await materialize(session.vault); download(await seal(vault, session.key, session.envelope.salt, session.envelope.iterations)); })} disabled={busy}>↓ 导出备份</Button>{backupPicker}</div></section>}<main>{draft ? <><div className="detail-toolbar"><Space><Button aria-pressed={preview} type={preview ? 'primary' : 'default'} onClick={() => setPreview(!preview)}>预览</Button><Button disabled={busy} onClick={() => leave(() => { dispatchDraft({ type: 'remove', id: draft.id }); if (!notes.some(note => note.id === draft.id)) setSelected(notes[0]?.id); })}>取消</Button><Button type="primary" loading={busy} onClick={() => void run(async () => { if (!draft.title.trim() || (!draft.body.trim() && !draft.images?.length && !draft.attachments?.length)) throw Error('请填写标题，并添加正文或文件。'); const note = { ...draft, title: draft.title.trim(), tag: draft.tag.trim(), updated: new Date().toISOString() }; await save([...notes.filter(n => n.id !== note.id), note]); setSelected(note.id); dispatchDraft({ type: 'remove', id: note.id }); setTag(''); setQuery(''); void message.success('已保存。'); })}>保存笔记</Button></Space></div><Typography.Title level={2}>{notes.some(n => n.id === draft.id) ? '编辑笔记' : '新建笔记'}{dirtyIds.has(draft.id) && <span className="unsaved-dot" role="img" aria-label="未保存" title="未保存" />}</Typography.Title><div className={`editor-layout${preview ? ' with-preview' : ''}`}><div className="editor" onPaste={e => { const files = transferredFiles(e.clipboardData); if (files.length) { e.preventDefault(); void addFiles(files); } }} onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); }} onDrop={e => { const files = transferredFiles(e.dataTransfer); if (files.length) { e.preventDefault(); void addFiles(files); } }}><label>标题<Input aria-label="标题" value={draft.title} maxLength={200} disabled={busy} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>标签<Input aria-label="标签" value={draft.tag} maxLength={40} disabled={busy} onChange={e => setDraft({ ...draft, tag: e.target.value })} /></label><div className="image-tools"><label className="file-button"><input aria-label="添加图片" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={busy} onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; void addFiles(files, true); }} /><span>＋ 添加图片</span></label><label className="file-button"><input aria-label="添加附件" type="file" multiple disabled={busy} onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; void addFiles(files); }} /><span>＋ 添加附件</span></label><label className="file-button"><input aria-label="插入 HTML" type="file" accept=".html,.htm,text/html" multiple disabled={busy} onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; void addFiles(files); }} /><span>＋ 插入 HTML</span></label></div>{!!draft.images?.length && <details className="editor-images" key={draft.id} onToggle={event => setImagesExpanded(event.currentTarget.open)}><summary>图片（{draft.images.length}）</summary><div className="image-gallery">{imagesExpanded && draft.images?.map(img => <div className="image-card" key={img.id}><StoredImage image={img} /><span title={img.name}>{img.name}</span><Space size={2}><Button size="small" disabled={busy} onClick={() => setDraft({ ...draft, body: draft.body + `\n\n![图片](image:${img.id})\n\n` })}>插入正文</Button><Button size="small" danger disabled={busy} onClick={() => setDraft({ ...draft, images: draft.images?.filter(i => i.id !== img.id), body: draft.body.split('\n').filter(l => imageMarker(l)?.[1] !== img.id).join('\n') })}>移除</Button></Space></div>)}</div></details>}<Attachments files={draft.attachments || []} disabled={busy} onInsertHtml={insertHtml} onHtmlStateChange={saveHtmlState} onRemove={id => setDraft({ ...draft, attachments: draft.attachments?.filter(file => file.id !== id), body: draft.body.split('\n').filter(line => htmlMarker(line)?.[1] !== id).join('\n') })} /><label>正文<Input.TextArea id="note-body" aria-label="正文" value={draft.body} disabled={busy} autoSize={{ minRows: 14, maxRows: preview ? 28 : undefined }} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label></div>{preview && <section className="editor-preview" aria-label="笔记预览"><Typography.Title level={2}>{draft.title}</Typography.Title>{draft.tag && <Tag>{draft.tag}</Tag>}<Markdown body={draft.body} images={draft.images} htmlFiles={draft.attachments} onHtmlStateChange={saveHtmlState} copied={text => void copied(text)} /><Attachments files={draft.attachments || []} onHtmlStateChange={saveHtmlState} /></section>}</div></> : current ? <><div className="detail-heading"><Typography.Title>{current.title}</Typography.Title><Space wrap><Button onClick={() => void copied(current.body)}>复制原文</Button><Button onClick={() => edit(current)} disabled={busy}>编辑笔记</Button><Popconfirm title="确定删除这篇笔记？" okText="删除" cancelText="取消" onConfirm={() => run(async () => { const remaining = notes.filter(n => n.id !== current.id); await save(remaining); dispatchDraft({ type: 'remove', id: current.id }); setSelected(remaining[0]?.id); })}><Button type="text" danger disabled={busy}>删除</Button></Popconfirm></Space></div><div className="metadata"><Tag>{current.tag || '未分类'}</Tag><small>更新于 {date(current.updated)}</small></div><Markdown key={current.id} body={current.body} images={current.images} htmlFiles={current.attachments} onHtmlStateChange={saveHtmlState} copied={text => void copied(text)} /><Attachments files={current.attachments || []} onHtmlStateChange={saveHtmlState} /></> : <div className="blank"><Empty description="暂无笔记"><Button type="primary" onClick={() => edit()}>创建第一篇笔记</Button></Empty></div>}</main></div><Modal title="导入备份" open={!!incoming} onCancel={() => { if (!busy) { setIncoming(undefined); setBackupPassword(''); } }} onOk={() => void restore()} confirmLoading={busy} okText="导入" cancelText="取消" destroyOnHidden><Input.Password aria-label="备份密码" placeholder="备份密码" value={backupPassword} onChange={e => setBackupPassword(e.target.value)} onPressEnter={() => void restore()} style={{ marginTop: 20 }} /></Modal></div>;
}
function Root() {
  const [themeName, setThemeName] = useState<ThemeName>(readTheme);
  useLayoutEffect(() => applyTheme(themeName), [themeName]);
  const current = themes[themeName], colors = current.colors;
  return <ConfigProvider locale={zhCN} theme={{ algorithm: current.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorPrimary: colors.primary, colorInfo: colors.primary, colorBgBase: colors.bg, colorBgLayout: colors.bg, colorBgContainer: colors.card, colorBgElevated: colors.card, colorText: colors.text, colorTextHeading: colors.heading, colorTextLightSolid: current.dark ? colors.panel : '#ffffff', colorTextSecondary: colors.muted, colorBorder: colors.border, colorBorderSecondary: colors.border, colorLink: colors.link, borderRadius: 8, fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif' } }}><AntApp><Shiye themeName={themeName} onThemeChange={setThemeName} /></AntApp></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Root />);
