// 百度翻译签名协议要求 MD5；此实现只用于该协议，不用于密码存储。
export function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(length - 8, bits >>> 0, true);
  view.setUint32(length - 4, Math.floor(bits / 0x100000000), true);
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let offset = 0; offset < length; offset += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, index;
      if (i < 16) { f = (b & c) | (~b & d); index = i; }
      else if (i < 32) { f = (d & b) | (~d & c); index = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; index = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); index = (7 * i) % 16; }
      const sum = (a + f + constants[i] + view.getUint32(offset + index * 4, true)) >>> 0;
      const shift = shifts[Math.floor(i / 16) * 4 + i % 4];
      const rotated = ((sum << shift) | (sum >>> (32 - shift))) >>> 0;
      [a, b, c, d] = [d, (b + rotated) >>> 0, b, c];
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const output = new Uint8Array(16);
  const result = new DataView(output.buffer);
  [a0, b0, c0, d0].forEach((word, i) => result.setUint32(i * 4, word, true));
  return Array.from(output, byte => byte.toString(16).padStart(2, '0')).join('');
}
