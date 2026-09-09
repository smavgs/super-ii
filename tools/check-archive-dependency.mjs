import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Zip = require(process.argv[2] || 'adm-zip');
// Use a real path: macOS itself aliases /tmp through a symlink.
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'superii-archive-check-')));
try {
  for (const linkType of ['file', 'directory']) {
    for (const method of ['all', 'entry', 'async']) {
      const fixture = join(temporary, `${linkType}-${method}`);
      const root = join(fixture, 'root');
      const outside = join(fixture, 'outside');
      mkdirSync(root, { recursive: true });
      mkdirSync(outside);
      const target = join(outside, 'payload.txt');
      writeFileSync(target, 'original');
      const name = linkType === 'file' ? 'payload.txt' : 'link/payload.txt';
      symlinkSync(linkType === 'file' ? target : outside, join(root, linkType === 'file' ? name : 'link'), linkType === 'file' ? 'file' : 'dir');
      const writer = new Zip();
      writer.addFile(name, Buffer.from('replacement'));
      const zip = new Zip(writer.toBuffer());
      if (method === 'async') {
        const error = await new Promise(resolve => zip.extractAllToAsync(root, true, false, resolve));
        assert.ok(error, 'Asynchronous extraction must reject destination symlinks');
      } else {
        assert.throws(() => method === 'all'
          ? zip.extractAllTo(root, true)
          : zip.extractEntryTo(zip.getEntry(name), root, true, true));
      }
      assert.equal(readFileSync(target, 'utf8'), 'original', `${linkType}/${method} changed a file outside the extraction root`);
    }
  }
  const zip = new Zip();
  zip.addFile('nested/ordinary.txt', Buffer.from('ordinary content'));
  const ordinary = join(temporary, 'ordinary');
  new Zip(zip.toBuffer()).extractAllTo(ordinary, true);
  assert.equal(readFileSync(join(ordinary, 'nested/ordinary.txt'), 'utf8'), 'ordinary content');
  console.log('Archive dependency: normal extraction passes; file and directory symlinks are rejected by all three extraction APIs');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
