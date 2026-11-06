import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
const locks = new Set();
export const io = { reads: [], writes: [], fail: '' };
export function resetIO() { io.reads = []; io.writes = []; io.fail = ''; }
export class DiskDirectory {
  constructor(path) { this.path = path; }
  async getDirectoryHandle(name, { create = false } = {}) {
    const path = join(this.path, name);
    if (create) await mkdir(path, { recursive: true });
    return new DiskDirectory(path);
  }
  async getFileHandle(name, { create = false } = {}) {
    const path = join(this.path, name);
    if (create) { try { await writeFile(path, '', { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    else { try { await readFile(path); } catch (e) { if (e.code === 'ENOENT') throw new DOMException('Missing file', 'NotFoundError'); throw e; } }
    return {
      async getFile() { io.reads.push(name); return new File([new Uint8Array(await readFile(path))], name, { lastModified: (await stat(path)).mtimeMs }); },
      async createWritable(options) {
        if (options?.mode === 'exclusive' && locks.has(path)) throw Error('file locked');
        locks.add(path);
        let pending;
        return {
          async write(value) { pending = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value); },
          async close() {
            if (name === io.fail || io.fail === '*') throw Error('simulated disk failure');
            await writeFile(path + '.new', pending); await rename(path + '.new', path);
            io.writes.push({ name, bytes: pending.length }); locks.delete(path);
          },
          async abort() { locks.delete(path); },
        };
      },
    };
  }
  async removeEntry(name) { await unlink(join(this.path, name)); }
}
