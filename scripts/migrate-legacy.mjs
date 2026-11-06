// One-time developer utility. The application itself never invokes PowerShell or Node.
import { spawnSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes, randomUUID, createCipheriv } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
const input = process.argv[2];
if (!input) { console.error('Usage: npm run migrate -- "C:\\path\\to\\data.vault" [output.shiye]'); process.exit(1); }
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.Security; $b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:SHIYE_LEGACY_PATH),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write([Text.Encoding]::UTF8.GetString($b))"], { env: { ...process.env, SHIYE_LEGACY_PATH: resolve(input) }, encoding: 'utf8', maxBuffer: 150 * 1024 * 1024, windowsHide: true });
if (result.status !== 0) { console.error('无法解密旧资料，请使用原 Windows 账户运行，并检查路径。'); process.exit(1); }
const legacy = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
if (!Array.isArray(legacy.notes)) throw Error('旧资料格式不正确。');
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
async function ask(prompt) { muted = false; const answer = new Promise(resolve => rl.question(prompt, resolve)); muted = true; const text = await answer; process.stdout.write('\n'); return text; }
try {
  const password = await ask('设置迁移备份密码（至少 8 位，输入不会显示）：');
  const confirm = await ask('再次输入：');
  if (password.length < 8 || password !== confirm) throw Error('密码不足 8 位或两次不一致，未生成文件。');
  const salt = randomBytes(16), iv = randomBytes(12), iterations = 310000;
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ notes: legacy.notes }), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const envelope = { kind: 'shiye-v2', version: 2, iterations, salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: encrypted.toString('base64'), revision: randomUUID() };
  const target = resolve(process.argv[3] || '旧版资料迁移.shiye');
  await writeFile(target, JSON.stringify(envelope), { flag: 'wx' });
  console.log(`已生成加密迁移备份：${target}\n在新版mynote中导入即可；原文件未修改，没有生成明文资料。`);
} finally { rl.close(); }
