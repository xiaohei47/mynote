import { bytes64, from64, validateEnvelope, validateVault, MAX_BYTES, type Envelope, type Note, type Vault, type NoteImage, type Attachment } from './storage';

interface RecordRef { id: string; file: string }
interface Manifest { kind: 'shiye-files-v1'; records: RecordRef[] }
const namePattern = /^[a-f0-9-]{36}\.(bin|note)$/;
let directory: FileSystemDirectoryHandle | undefined;
let assetKey: CryptoKey | undefined;
let snapshot: { revision: string; notes: Note[]; records: RecordRef[] } | undefined;
const encoder = new TextEncoder(), decoder = new TextDecoder();
export function mountFiles(handle: FileSystemDirectoryHandle) { directory = handle; assetKey = undefined; snapshot = undefined; }
export function lockAssets() { assetKey = undefined; snapshot = undefined; }
function root() { if (!directory) throw Error('请先选择资料目录。'); return directory; }
async function contentDirectory() { return root().getDirectoryHandle('content', { create: true }); }
async function optionalFile(name: string): Promise<File | undefined> {
  try { return await (await root().getFileHandle(name)).getFile(); }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return; throw error; }
}
export async function readIndex(): Promise<Envelope | undefined> {
  const file = await optionalFile('index.shiye');
  if (!file?.size) return;
  if (file.size > 8 * 1024 * 1024) throw Error('目录索引过大。');
  const envelope = JSON.parse(await file.text()); validateEnvelope(envelope);
  if (envelope.format !== 'files-v1') throw Error('目录索引格式不正确。');
  return envelope;
}
export async function readMigration(): Promise<Envelope | undefined> {
  const file = await optionalFile('migration.shiye');
  if (file) {
    const original = await optionalFile('shiye.sqlite');
    if (original && original.lastModified > file.lastModified) throw Error('旧版资料在迁移文件生成后有更新，请关闭旧页面并重新生成迁移文件。');
    if (file.size > MAX_BYTES * 1.4 + 4096) throw Error('迁移文件过大。');
    const envelope = JSON.parse(await file.text()); validateEnvelope(envelope); return envelope;
  }
  if ((await optionalFile('shiye.sqlite'))?.size) throw Error('发现旧版 SQLite 资料，请先运行项目中的 migrate-sqlite.mjs，或从旧版导出加密备份后导入。');
}
export async function encryptBytes(bytes: Uint8Array<ArrayBuffer>, key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const output = new Uint8Array(12 + cipher.length); output.set(iv); output.set(cipher, 12); return output;
}
async function decryptBytes(bytes: Uint8Array<ArrayBuffer>, key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}
async function readContent(name: string, key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  if (!namePattern.test(name)) throw Error('文件引用无效。');
  const file = await (await (await contentDirectory()).getFileHandle(name)).getFile();
  if (file.size > MAX_BYTES) throw Error('资料文件过大。');
  return decryptBytes(new Uint8Array(await file.arrayBuffer()), key);
}
export async function assetBytes(file: NoteImage | Attachment): Promise<Uint8Array<ArrayBuffer>> {
  if (file.blob) {
    if (!assetKey) throw Error('请先解锁资料库。');
    const bytes = await readContent(file.blob, assetKey);
    if (bytes.length !== file.size) throw Error('附件数据不完整。');
    return bytes;
  }
  return from64(file.data.startsWith('data:') ? file.data.slice(file.data.indexOf(',') + 1) : file.data);
}
export async function imageData(image: NoteImage): Promise<string> {
  return image.blob ? `data:${image.type};base64,${bytes64(await assetBytes(image))}` : image.data;
}
export async function materialize(vault: Vault): Promise<Vault> {
  const notes: Note[] = [];
  for (const note of vault.notes) {
    const images: NoteImage[] = [], attachments: Attachment[] = [];
    for (const image of note.images || []) { const { blob, type, size, ...rest } = image; images.push({ ...rest, data: await imageData(image) }); }
    for (const file of note.attachments || []) { const { blob, ...rest } = file; attachments.push({ ...rest, data: bytes64(await assetBytes(file)) }); }
    notes.push({ ...note, images, attachments });
  }
  return { notes };
}
export async function openManifest(value: unknown, envelope: Envelope, key: CryptoKey): Promise<Vault> {
  const manifest = value as Manifest;
  if (manifest?.kind !== 'shiye-files-v1' || !Array.isArray(manifest.records) || manifest.records.length > 10000 || manifest.records.some(r => typeof r?.id !== 'string' || !namePattern.test(r.file) || !r.file.endsWith('.note')) || new Set(manifest.records.map(r => r.id)).size !== manifest.records.length) throw Error('目录索引已损坏。');
  const notes: Note[] = [];
  for (const record of manifest.records) {
    const note = JSON.parse(decoder.decode(await readContent(record.file, key))) as Note;
    validateVault({ notes: [note] });
    if (note.id !== record.id) throw Error('笔记索引与内容不一致。');
    notes.push(note);
  }
  assetKey = key; snapshot = { revision: envelope.revision, notes, records: manifest.records };
  return { notes };
}
function references(notes: Note[], records: RecordRef[]): Set<string> {
  return new Set([...records.map(r => r.file), ...notes.flatMap(n => [...(n.images || []), ...(n.attachments || [])].flatMap(f => f.blob ? [f.blob] : []))]);
}
export async function writeVault(vault: Vault, key: CryptoKey, salt: string, iterations: number, expectedRevision?: string): Promise<{ vault: Vault; envelope: Envelope }> {
  validateVault(vault);
  if (vault.notes.length > 10000) throw Error('笔记数量超过支持的上限。');
  const indexHandle = await root().getFileHandle('index.shiye', { create: true });
  const writable = await indexHandle.createWritable({ keepExistingData: false, mode: 'exclusive' } as FileSystemCreateWritableOptions);
  const created: string[] = [];
  let content: FileSystemDirectoryHandle | undefined;
  const previous = snapshot;
  let committed = false;
  try {
    content = await contentDirectory();
    const current = await readIndex();
    if (current?.revision !== expectedRevision) throw Error('其他窗口已更新资料，请先复制保留修改，再刷新重试。');
    if (current && (current.salt !== salt || current.iterations !== iterations)) throw Error('资料库已更换，请重新解锁。');
    if (current && previous?.revision !== expectedRevision) throw Error('请重新打开资料库后保存。');
    const allowed = references(previous?.notes || [], previous?.records || []);
    async function writeContent(bytes: Uint8Array<ArrayBuffer>, extension: 'bin' | 'note'): Promise<string> {
      const name = `${crypto.randomUUID()}.${extension}`, encrypted = await encryptBytes(bytes, key);
      created.push(name);
      const handle = await content!.getFileHandle(name, { create: true });
      const stream = await handle.createWritable();
      try { await stream.write(encrypted); await stream.close(); } catch (error) { try { await stream.abort(); } catch {} throw error; }
      const verified = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (verified.length !== encrypted.length || verified.some((v, i) => v !== encrypted[i])) throw Error('文件写入校验失败，原资料未修改。');
      return name;
    }
    async function storedAsset<T extends NoteImage | Attachment>(file: T): Promise<T> {
      if (file.blob) { if (!allowed.has(file.blob)) throw Error('附件引用已失效，请刷新后重试。'); return { ...file, data: '' }; }
      const bytes = await assetBytes(file);
      const blob = await writeContent(bytes, 'bin');
      if ('size' in file && 'type' in file && typeof file.size === 'number') return { ...file, data: '', blob };
      return { ...file, data: '', blob, type: /^data:([^;]+)/.exec(file.data)?.[1], size: bytes.length };
    }
    const notes: Note[] = [], records: RecordRef[] = [];
    let total = 0;
    for (const note of vault.notes) {
      const images: NoteImage[] = [], attachments: Attachment[] = [];
      for (const image of note.images || []) images.push(await storedAsset(image));
      for (const file of note.attachments || []) attachments.push(await storedAsset(file));
      const stored = { ...note, images, attachments }, json = JSON.stringify(stored);
      total += encoder.encode(json).length + [...images, ...attachments].reduce((sum, f) => sum + Math.ceil((f.size || 0) / 3) * 4, 0);
      if (total > MAX_BYTES) throw Error('资料库超过 100 MB，请减少文件。');
      const old = previous?.notes.find(n => n.id === note.id);
      const oldRecord = previous?.records.find(r => r.id === note.id);
      const file = oldRecord && JSON.stringify(old) === json ? oldRecord.file : await writeContent(encoder.encode(json), 'note');
      notes.push(stored); records.push({ id: note.id, file });
    }
    const encrypted = await encryptBytes(encoder.encode(JSON.stringify({ kind: 'shiye-files-v1', records } satisfies Manifest)), key);
    const envelope: Envelope = { kind: 'shiye-v2', version: 2, format: 'files-v1', iterations, salt, iv: bytes64(encrypted.slice(0, 12)), ciphertext: bytes64(encrypted.slice(12)), revision: crypto.randomUUID() };
    if (encoder.encode(JSON.stringify(envelope)).length > 8 * 1024 * 1024) throw Error('目录索引过大。');
    await writable.write(JSON.stringify(envelope)); await writable.close(); committed = true;
    assetKey = key; snapshot = { revision: envelope.revision, notes, records };
    // Old immutable files are removed only after the new index is committed.
    const keep = references(notes, records);
    for (const name of references(previous?.notes || [], previous?.records || [])) if (!keep.has(name)) await content.removeEntry(name).catch(() => {});
    return { vault: { notes }, envelope };
  } catch (error) {
    if (!committed) {
      try { await writable.abort(); } catch {}
      for (const name of created) await content?.removeEntry(name).catch(() => {});
    }
    throw error;
  }
}
