export function createCanvas(width, height, [r, g, b]) {
  const buf = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    buf[i * 3] = r
    buf[i * 3 + 1] = g
    buf[i * 3 + 2] = b
  }
  return buf
}

function setPixel(buf, width, height, x, y, [r, g, b], alpha = 1) {
  if (x < 0 || x >= width || y < 0 || y >= height) return
  const idx = (y * width + x) * 3
  if (alpha >= 1) {
    buf[idx] = r
    buf[idx + 1] = g
    buf[idx + 2] = b
  } else {
    buf[idx] = buf[idx] * (1 - alpha) + r * alpha
    buf[idx + 1] = buf[idx + 1] * (1 - alpha) + g * alpha
    buf[idx + 2] = buf[idx + 2] * (1 - alpha) + b * alpha
  }
}

/** Even-odd scanline fill. `points` are pixel-space {x,y}. */
export function fillPolygon(buf, width, height, points, color, alpha = 1) {
  if (points.length < 3) return
  let minY = Infinity, maxY = -Infinity
  for (const p of points) {
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  minY = Math.max(0, Math.floor(minY))
  maxY = Math.min(height - 1, Math.ceil(maxY))

  for (let y = minY; y <= maxY; y++) {
    const scanY = y + 0.5
    const xs = []
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
        const t = (scanY - a.y) / (b.y - a.y)
        xs.push(a.x + t * (b.x - a.x))
      }
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xStart = Math.max(0, Math.round(xs[i]))
      const xEnd = Math.min(width - 1, Math.round(xs[i + 1]))
      for (let x = xStart; x <= xEnd; x++) setPixel(buf, width, height, x, y, color, alpha)
    }
  }
}

export function drawLine(buf, width, height, p1, p2, color, thicknessPx = 1) {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.hypot(dx, dy)
  const steps = Math.max(1, Math.ceil(len))
  const half = thicknessPx / 2
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const cx = p1.x + dx * t
    const cy = p1.y + dy * t
    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) {
        setPixel(buf, width, height, Math.round(cx + ox), Math.round(cy + oy), color)
      }
    }
  }
}
