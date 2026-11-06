import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function extractLegacy(directory) {
  const root = resolve(directory), target = join(root, 'migration.shiye');
  const db = new DatabaseSync(join(root, 'shiye.sqlite'), { readOnly: true });
  let envelope;
  try {
    if (db.prepare('PRAGMA application_id').get().application_id !== 0x53485945 || db.prepare('PRAGMA user_version').get().user_version !== 1) throw Error('不是受支持的mynote数据库。');
    envelope = JSON.parse(db.prepare('SELECT envelope FROM vault WHERE id = 1').get()?.envelope || 'null');
    if (envelope?.kind !== 'shiye-v2' || envelope.version !== 2 || typeof envelope.ciphertext !== 'string' || !envelope.revision) throw Error('旧资料格式不正确。');
  } finally { db.close(); }
  const data = JSON.stringify(envelope);
  try { await writeFile(target, data, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST' || await readFile(target, 'utf8') !== data) throw error; }
  return target;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('用法：node scripts/migrate-sqlite.mjs 用户的 .shiye 目录');
  console.log(`已准备加密迁移文件：${await extractLegacy(process.argv[2])}，SQLite 原文件未修改。`);
}
