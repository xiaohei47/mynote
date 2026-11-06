import { mountFiles, openManifest, readIndex, readMigration, writeVault } from './file-vault';
export { assetBytes, imageData, materialize, lockAssets } from './file-vault';
export interface NoteImage { id: string; name: string; data: string; blob?: string; type?: string; size?: number }
export interface HtmlState { revision: string; tasks: Record<string, unknown>[] }
export interface Attachment { id: string; name: string; type: string; size: number; data: string; blob?: string; htmlState?: HtmlState }
export interface Note { id: string; title: string; body: string; tag: string; created: string; updated: string; pinned?: boolean; images?: NoteImage[]; attachments?: Attachment[] }
export function compareNotes(a: Note, b: Note): number { return Number(!!b.pinned) - Number(!!a.pinned) || b.updated.localeCompare(a.updated); }
export interface Vault { notes: Note[] }
export interface Envelope { kind: 'shiye-v2'; version: 2; format?: 'files-v1'; iterations: number; salt: string; iv: string; ciphertext: string; revision: string }
export const MAX_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ITERATIONS = 310_000;
const encoder = new TextEncoder();
export function bytes64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function from64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function attachmentBytes(file: Attachment): Uint8Array<ArrayBuffer> { return from64(file.data); }
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw Error(`文件“${file.name}”超过 20 MB。`);
  return { id: crypto.randomUUID(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, data: bytes64(new Uint8Array(await file.arrayBuffer())) };
}
export function transferredFiles(transfer: Pick<DataTransfer, 'files' | 'items'>): File[] {
  if (transfer.files.length) return [...transfer.files];
  return [...transfer.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
}
export function safeImage(data: string): boolean { return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(data); }
function validBlob(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9-]{36}\.bin$/.test(value); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
export function validateHtmlState(value: unknown): asserts value is HtmlState {
  if (!object(value) || typeof value.revision !== 'string' || !value.revision || !Array.isArray(value.tasks) || value.tasks.length > 10000 || value.tasks.some(task => !object(task) || typeof task.id !== 'string' || typeof task.content !== 'string') || new Set(value.tasks.map(task => task.id)).size !== value.tasks.length || encoder.encode(JSON.stringify(value)).length > 2 * 1024 * 1024) throw Error('HTML 待办数据格式错误或超过限制。');
}
export function validateVault(value: unknown): asserts value is Vault {
  if (!object(value) || !Array.isArray(value.notes)) throw Error('文件不是有效的mynote资料库。');
  const ids = new Set<string>();
  for (const n of value.notes) {
    if (!object(n) || ['id', 'title', 'body', 'tag', 'created', 'updated'].some(k => typeof n[k] !== 'string')) throw Error('笔记内容格式不正确。');
    if (n.pinned !== undefined && typeof n.pinned !== 'boolean') throw Error('置顶状态格式不正确。');
    const id = n.id as string;
    if (ids.has(id) || !id) throw Error('笔记标识重复或为空。');
    ids.add(id);
    if (n.images !== undefined) {
      if (!Array.isArray(n.images)) throw Error('图片格式不正确。');
      const imageIds = new Set<string>();
      for (const img of n.images) {
        if (!object(img) || typeof img.id !== 'string' || !/^[\w-]+$/.test(img.id) || imageIds.has(img.id) || typeof img.name !== 'string' || typeof img.data !== 'string' || (img.blob !== undefined ? !validBlob(img.blob) || img.data !== '' || typeof img.type !== 'string' || !/^image\/(png|jpeg|webp|gif)$/.test(img.type) || !Number.isInteger(img.size) || (img.size as number) < 0 || (img.size as number) > 5 * 1024 * 1024 : !safeImage(img.data) || atob(img.data.split(',')[1]).length > 5 * 1024 * 1024)) throw Error('图片无效或超过 5 MB。');
        imageIds.add(img.id);
      }
    }
    if (n.attachments !== undefined) {
      if (!Array.isArray(n.attachments)) throw Error('附件格式不正确。');
      const attachmentIds = new Set<string>();
      for (const file of n.attachments) {
        if (!object(file) || typeof file.id !== 'string' || !/^[\w-]+$/.test(file.id) || attachmentIds.has(file.id) || typeof file.name !== 'string' || !file.name || typeof file.type !== 'string' || !Number.isInteger(file.size) || (file.size as number) < 0 || (file.size as number) > MAX_ATTACHMENT_BYTES || typeof file.data !== 'string' || file.data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) throw Error('附件无效或超过 20 MB。');
        try { if (file.blob !== undefined ? !validBlob(file.blob) || file.data !== '' : !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) || atob(file.data).length !== file.size) throw Error(); }
        catch { throw Error('附件数据不完整。'); }
        if (file.htmlState !== undefined) validateHtmlState(file.htmlState);
        attachmentIds.add(file.id);
      }
    }
  }
}
export function validateEnvelope(value: unknown): asserts value is Envelope {
  if (!object(value) || value.kind !== 'shiye-v2' || value.version !== 2 || !Number.isInteger(value.iterations) || (value.iterations as number) < 100_000 || (value.iterations as number) > 1_000_000 || ['salt', 'iv', 'ciphertext', 'revision'].some(k => typeof value[k] !== 'string')) throw Error('备份格式不正确。');
  if (value.format !== undefined && value.format !== 'files-v1') throw Error('资料格式不正确。');
  if (atob(value.salt as string).length !== 16 || atob(value.iv as string).length !== 12 || atob(value.ciphertext as string).length < 16) throw Error('备份数据不完整。');
}
export async function deriveKey(password: string, salt: string, iterations = ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: from64(salt), iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(vault: Vault, key: CryptoKey, salt: string, iterations = ITERATIONS): Promise<Envelope> {
  validateVault(vault);
  const plain = encoder.encode(JSON.stringify(vault));
  if (plain.length > MAX_BYTES) throw Error('资料库超过 100 MB，请减少图片或资料。');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { kind: 'shiye-v2', version: 2, iterations, salt, iv: bytes64(iv), ciphertext: bytes64(new Uint8Array(cipher)), revision: crypto.randomUUID() };
}
export async function unlock(envelope: Envelope, password: string): Promise<{ vault: Vault; key: CryptoKey }> {
  validateEnvelope(envelope);
  const key = await deriveKey(password, envelope.salt, envelope.iterations);
  return unlockWithKey(envelope, key);
}
export async function unlockWithKey(envelope: Envelope, key: CryptoKey): Promise<{ vault: Vault; key: CryptoKey }> {
  let plain: ArrayBuffer;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: from64(envelope.iv) }, key, from64(envelope.ciphertext)); }
  catch { throw Error('密码不正确，或备份已损坏。'); }
  if (plain.byteLength > MAX_BYTES) throw Error('资料库超过 100 MB。');
  const vault: unknown = JSON.parse(new TextDecoder().decode(plain));
  if (envelope.format === 'files-v1') return { vault: await openManifest(vault, envelope, key), key };
  validateVault(vault);
  return { vault, key };
}
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('shiye-offline-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(Error('浏览器无法打开本地数据库，请使用普通模式的 Chrome 或 Edge。')); };
    request.onblocked = () => reject(Error('数据库被其他窗口占用，请关闭旧页面重试。'));
  });
}
type DirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};
declare global {
  interface Window {
    showDirectoryPicker(options: { id: string; mode: 'readwrite' }): Promise<DirectoryHandle>;
  }
}
let directory: DirectoryHandle | undefined;

async function readMetadata<T>(key: string): Promise<T | undefined> {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const request = connection.transaction('vault').objectStore('vault').get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}
async function rememberDirectory(handle: DirectoryHandle): Promise<void> {
  const connection = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = connection.transaction('vault', 'readwrite');
    tx.objectStore('vault').put(handle, 'data-directory');
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(Error('无法记住目录授权，请检查浏览器存储权限。'));
  });
}
export async function connectDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  mountFiles(handle);
}
async function mountDirectory(handle: DirectoryHandle): Promise<void> {
  await connectDirectory(handle);
  directory = handle;
  await rememberDirectory(handle);
}
export async function prepareStorage(): Promise<{ ready: boolean; canResume: boolean }> {
  if (typeof window.showDirectoryPicker !== 'function') throw Error('当前浏览器不支持目录读写，请使用 Chrome 或 Edge。');
  directory = await readMetadata<DirectoryHandle>('data-directory');
  if (!directory) return { ready: false, canResume: false };
  if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') return { ready: false, canResume: true };
  await mountDirectory(directory);
  return { ready: true, canResume: true };
}
export async function openStorageDirectory(chooseNew = false): Promise<boolean> {
  let handle = directory;
  try {
    if (!handle || chooseNew) handle = await window.showDirectoryPicker({ id: 'shiye-data', mode: 'readwrite' });
    else if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw Error('未获得目录读写权限。');
    await mountDirectory(handle);
    return true;
  } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return false; throw error; }
}
export async function loadEnvelope(): Promise<Envelope | undefined> {
  return await readIndex() || await readMigration() || await readMetadata<Envelope>('current');
}
export async function saveVault(vault: Vault, key: CryptoKey, salt: string, iterations = ITERATIONS, expectedRevision?: string) {
  return writeVault(vault, key, salt, iterations, expectedRevision);
}
export async function migrateVault(vault: Vault, key: CryptoKey, envelope: Envelope) {
  return envelope.format === 'files-v1' ? { vault, key, envelope } : { ...await saveVault(vault, key, envelope.salt, envelope.iterations), key };
}
export const REMEMBER_DAYS = 30;
interface RememberedUnlock { key: CryptoKey; salt: string; iterations: number; expiresAt: number }
async function storeRemembered(value?: RememberedUnlock): Promise<void> {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('vault', 'readwrite');
    const store = tx.objectStore('vault');
    if (value) store.put(value, 'remembered-unlock'); else store.delete('remembered-unlock');
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(Error('无法更新登录记忆，请检查浏览器存储权限。'));
  });
}
export async function rememberUnlock(envelope: Envelope, key: CryptoKey): Promise<void> {
  await storeRemembered({ key, salt: envelope.salt, iterations: envelope.iterations, expiresAt: Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000 });
}
export async function forgetUnlock(): Promise<void> { await storeRemembered(); }
export async function recallUnlock(envelope: Envelope): Promise<{ vault: Vault; key: CryptoKey } | undefined> {
  const connection = await db();
  const saved = await new Promise<RememberedUnlock | undefined>((resolve, reject) => {
    const request = connection.transaction('vault').objectStore('vault').get('remembered-unlock');
    request.onsuccess = () => resolve(request.result as RememberedUnlock | undefined);
    request.onerror = () => reject(request.error);
  });
  if (!saved) return;
  if (!Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now() || saved.salt !== envelope.salt || saved.iterations !== envelope.iterations) { await forgetUnlock(); return; }
  try { validateEnvelope(envelope); return await unlockWithKey(envelope, saved.key); }
  catch { await forgetUnlock(); }
}
export async function newVault(password: string) {
  if (password.length < 8) throw Error('请设置至少 8 位密码。');
  const salt = bytes64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(password, salt);
  const vault: Vault = { notes: [] };
  return { ...await saveVault(vault, key, salt), key };
}
