import zlib from 'node:zlib'

/** Minimal PNG decoder (8-bit RGB/RGBA/grayscale/palette, non-interlaced) — for reading fetched map tiles. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let offset = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0
  const idatChunks = []
  let palette = null

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data.readUInt8(8)
      colorType = data.readUInt8(9)
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  const isPalette = colorType === 3
  if (isPalette && bitDepth !== 8) throw new Error(`unsupported palette bit depth ${bitDepth}`)
  if (!isPalette && bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  const channels = isPalette ? 1 : { 0: 1, 2: 3, 6: 4 }[colorType]
  if (!channels) throw new Error(`unsupported color type ${colorType}`)
  if (isPalette && !palette) throw new Error('palette color type with no PLTE chunk')

  const raw = zlib.inflateSync(Buffer.concat(idatChunks))
  const stride = width * channels
  const defiltered = Buffer.alloc(height * stride)
  let rawOffset = 0

  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset]
    rawOffset += 1
    const rowStart = y * stride
    const prevRowStart = (y - 1) * stride

    for (let x = 0; x < stride; x++) {
      const raw8 = raw[rawOffset + x]
      const a = x >= channels ? defiltered[rowStart + x - channels] : 0
      const b = y > 0 ? defiltered[prevRowStart + x] : 0
      const c = y > 0 && x >= channels ? defiltered[prevRowStart + x - channels] : 0
      let value
      switch (filterType) {
        case 0: value = raw8; break
        case 1: value = raw8 + a; break
        case 2: value = raw8 + b; break
        case 3: value = raw8 + Math.floor((a + b) / 2); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          value = raw8 + pr
          break
        }
        default: throw new Error(`unsupported filter type ${filterType}`)
      }
      defiltered[rowStart + x] = value & 0xff
    }
    rawOffset += stride
  }

  if (!isPalette) return { width, height, channels, data: defiltered }

  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    const idx = defiltered[i]
    rgb[i * 3] = palette[idx * 3]
    rgb[i * 3 + 1] = palette[idx * 3 + 1]
    rgb[i * 3 + 2] = palette[idx * 3 + 2]
  }
  return { width, height, channels: 3, data: rgb }
}
