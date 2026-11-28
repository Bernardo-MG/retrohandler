const fs = require('node:fs');

function assertX64Pe(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(fd, dos, 0, 64, 0) !== 64 || dos.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error(`Not a PE file: ${file}`);
    }
    const pe = Buffer.alloc(6);
    if (
      fs.readSync(fd, pe, 0, 6, dos.readUInt32LE(60)) !== 6 ||
      pe.readUInt32LE(0) !== 0x4550 ||
      pe.readUInt16LE(4) !== 0x8664
    ) {
      throw new Error(`Expected Windows x64 PE: ${file}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { assertX64Pe };
