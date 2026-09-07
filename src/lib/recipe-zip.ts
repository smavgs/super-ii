/** Deterministic, uncompressed ZIP for the small, generated text-only project. */
export function projectZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0, count = 0, total = 0;
  function crc(bytes: Uint8Array): number {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    return (value ^ 0xffffffff) >>> 0;
  }
  for (const [name, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.startsWith('/') || name.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('Unsafe archive path');
    const filename = encoder.encode(name), bytes = encoder.encode(content);
    total += bytes.length;
    if (total > 4 * 1024 * 1024 || ++count > 100) throw new Error('Generated archive is too large');
    const hash = crc(bytes), header = new Uint8Array(30 + filename.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(12, 0x21, true); view.setUint32(14, hash, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, filename.length, true); header.set(filename, 30);
    const central = new Uint8Array(46 + filename.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint16(14, 0x21, true); cv.setUint32(16, hash, true); cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true); cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true); central.set(filename, 46);
    chunks.push(header, bytes); directory.push(central); offset += header.length + bytes.length;
  }
  const directoryLength = directory.reduce((sum, value) => sum + value.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, count, true); ev.setUint16(10, count, true); ev.setUint32(12, directoryLength, true); ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directoryLength + end.length);
  let cursor = 0;
  for (const chunk of [...chunks, ...directory, end]) { result.set(chunk, cursor); cursor += chunk.length; }
  return result;
}
