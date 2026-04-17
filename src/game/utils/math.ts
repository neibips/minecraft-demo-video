export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const smoothstep = (value: number): number => value * value * (3 - 2 * value)

export const fract = (value: number): number => value - Math.floor(value)

export const hashString = (value: string): number => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const createSeededRandom = (seed: number) => {
  let state = seed >>> 0
  return (): number => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export const mod = (value: number, size: number): number => ((value % size) + size) % size

export const humanizeId = (id: string): string =>
  id
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
