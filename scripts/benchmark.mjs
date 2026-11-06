import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'fake-indexeddb/auto';
import { DiskDirectory, io, resetIO } from './file-test-support.mjs';
const result = await build({ entryPoints: ['src/storage.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022' });
const storage = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const path = await mkdtemp(join(tmpdir(), 'shiye-benchmark-'));
try {
  await storage.connectDirectory(new DiskDirectory(path));
  const created = await storage.newVault('benchmark-only-password');
  const file = await storage.readAttachment(new File([new Uint8Array(8 * 1024 * 1024).fill(123)], 'sample.zip'));
  const now = new Date().toISOString();
  const vault = { notes: [{ id: 'benchmark', title: 'benchmark', tag: '', body: 'sample', created: now, updated: now, attachments: [file] }] };
  const initial = await storage.saveVault(vault, created.key, created.envelope.salt, created.envelope.iterations, created.envelope.revision);
  resetIO();
  const started = performance.now();
  const saved = await storage.saveVault({ notes: initial.vault.notes.map(n => ({ ...n, body: 'edited' })) }, created.key, initial.envelope.salt, initial.envelope.iterations, initial.envelope.revision);
  const saveMs = performance.now() - started;
  const writes = [...io.writes], binaryReads = io.reads.filter(n => n.endsWith('.bin')).length;
  const reopened = await storage.unlockWithKey(await storage.loadEnvelope(), created.key);
  if (storage.bytes64(await storage.assetBytes(reopened.vault.notes[0].attachments[0])) !== file.data) throw Error('Roundtrip failed');
  console.log(JSON.stringify({ attachmentMB: 8, saveMs: Math.round(saveMs), writtenBytes: writes.reduce((sum, f) => sum + f.bytes, 0), binaryReadsDuringSave: binaryReads, binaryWritesDuringSave: writes.filter(f => f.name.endsWith('.bin')).length, residentAttachmentBase64Length: saved.vault.notes[0].attachments[0].data.length }));
} finally { await rm(path, { recursive: true }); }
