import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addFileCheckpoint, listCheckpoints, restoreCheckpoint } from '../src/checkpoints.js';
import { openDb, type Db } from '../src/db.js';

const dirs: string[] = [];
const dbs: Db[] = [];
function dbFor(dir: string): Db { const db = openDb(dir); dbs.push(db); return db; }
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-cp-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('write_file 检查点', () => {
  it('覆盖前保存旧内容，回滚恢复', () => {
    const dir = tmp();
    const db = dbFor(dir);
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'before');
    const id = addFileCheckpoint(db, {
      sessionId: 's1', tool: 'write_file', root: dir, filePath: file, before: 'before', existed: true,
    });
    expect(id).toBeTruthy();
    fs.writeFileSync(file, 'after');
    expect(restoreCheckpoint(db, id!)).toMatchObject({ ok: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('before');
    expect(listCheckpoints(db, 's1')).toHaveLength(1);
  });

  it('新建文件的检查点回滚会删除文件', () => {
    const dir = tmp();
    const db = dbFor(dir);
    const file = path.join(dir, 'new.txt');
    const id = addFileCheckpoint(db, {
      sessionId: 's2', tool: 'write_file', root: dir, filePath: file, before: null, existed: false,
    });
    fs.writeFileSync(file, 'new');
    expect(restoreCheckpoint(db, id!)).toMatchObject({ ok: true });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('拒绝恢复工作区外的路径', () => {
    const dir = tmp();
    const db = dbFor(dir);
    const outside = path.join(path.dirname(dir), 'outside.txt');
    const id = addFileCheckpoint(db, {
      sessionId: 's3', tool: 'write_file', root: dir, filePath: outside, before: 'x', existed: true,
    });
    expect(restoreCheckpoint(db, id!)).toMatchObject({ ok: false });
  });
});
