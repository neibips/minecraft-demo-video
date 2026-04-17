import { fract, hashString, lerp, smoothstep } from '../utils/math'

const hash2 = (seed: number, x: number, z: number): number => {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 0.0001) * 43758.5453123
  return fract(value)
}

const hash3 = (seed: number, x: number, y: number, z: number): number => {
  const value = Math.sin(x * 127.1 + y * 269.5 + z * 311.7 + seed * 0.0001) * 43758.5453123
  return fract(value)
}

export const createNoiseTools = (seedText: string) => {
  const seed = hashString(seedText)

  const value2d = (x: number, z: number): number => {
    const x0 = Math.floor(x)
    const z0 = Math.floor(z)
    const xf = x - x0
    const zf = z - z0

    const a = hash2(seed, x0, z0)
    const b = hash2(seed, x0 + 1, z0)
    const c = hash2(seed, x0, z0 + 1)
    const d = hash2(seed, x0 + 1, z0 + 1)

    const u = smoothstep(xf)
    const v = smoothstep(zf)
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1
  }

  const fbm2d = (x: number, z: number, octaves = 4, lacunarity = 2, gain = 0.5): number => {
    let amplitude = 1
    let frequency = 1
    let value = 0
    let totalAmplitude = 0
    for (let index = 0; index < octaves; index += 1) {
      value += value2d(x * frequency, z * frequency) * amplitude
      totalAmplitude += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }
    return totalAmplitude > 0 ? value / totalAmplitude : 0
  }

  const value3d = (x: number, y: number, z: number): number => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const z0 = Math.floor(z)
    const xf = x - x0
    const yf = y - y0
    const zf = z - z0

    const c000 = hash3(seed, x0, y0, z0)
    const c100 = hash3(seed, x0 + 1, y0, z0)
    const c010 = hash3(seed, x0, y0 + 1, z0)
    const c110 = hash3(seed, x0 + 1, y0 + 1, z0)
    const c001 = hash3(seed, x0, y0, z0 + 1)
    const c101 = hash3(seed, x0 + 1, y0, z0 + 1)
    const c011 = hash3(seed, x0, y0 + 1, z0 + 1)
    const c111 = hash3(seed, x0 + 1, y0 + 1, z0 + 1)

    const u = smoothstep(xf)
    const v = smoothstep(yf)
    const w = smoothstep(zf)

    const x00 = lerp(c000, c100, u)
    const x10 = lerp(c010, c110, u)
    const x01 = lerp(c001, c101, u)
    const x11 = lerp(c011, c111, u)
    const y0Blend = lerp(x00, x10, v)
    const y1Blend = lerp(x01, x11, v)

    return lerp(y0Blend, y1Blend, w) * 2 - 1
  }

  const fbm3d = (
    x: number,
    y: number,
    z: number,
    octaves = 4,
    lacunarity = 2,
    gain = 0.5,
  ): number => {
    let amplitude = 1
    let frequency = 1
    let value = 0
    let totalAmplitude = 0
    for (let index = 0; index < octaves; index += 1) {
      value += value3d(x * frequency, y * frequency, z * frequency) * amplitude
      totalAmplitude += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }
    return totalAmplitude > 0 ? value / totalAmplitude : 0
  }

  return { seed, value2d, fbm2d, value3d, fbm3d }
}
