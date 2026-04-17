import { createNoise2D, createNoise3D } from 'simplex-noise'
import type { NoiseFunction2D, NoiseFunction3D } from 'simplex-noise'
import { createSeededRandom, hashString } from '../utils/math'

const createFbm2d = (sample: NoiseFunction2D) => {
  return (x: number, z: number, octaves = 5, lacunarity = 2, gain = 0.5): number => {
    let amplitude = 1
    let frequency = 1
    let value = 0
    let totalAmplitude = 0

    for (let index = 0; index < octaves; index += 1) {
      value += sample(x * frequency, z * frequency) * amplitude
      totalAmplitude += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }

    return totalAmplitude > 0 ? value / totalAmplitude : 0
  }
}

const createFbm3d = (sample: NoiseFunction3D) => {
  return (
    x: number,
    y: number,
    z: number,
    octaves = 5,
    lacunarity = 2,
    gain = 0.5,
  ): number => {
    let amplitude = 1
    let frequency = 1
    let value = 0
    let totalAmplitude = 0

    for (let index = 0; index < octaves; index += 1) {
      value += sample(x * frequency, y * frequency, z * frequency) * amplitude
      totalAmplitude += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }

    return totalAmplitude > 0 ? value / totalAmplitude : 0
  }
}

const createRidged2d = (sample: NoiseFunction2D) => {
  return (x: number, z: number, octaves = 5, lacunarity = 2, gain = 0.5): number => {
    let amplitude = 1
    let frequency = 1
    let value = 0
    let totalAmplitude = 0

    for (let index = 0; index < octaves; index += 1) {
      const ridge = 1 - Math.abs(sample(x * frequency, z * frequency))
      value += ridge * ridge * amplitude
      totalAmplitude += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }

    return totalAmplitude > 0 ? value / totalAmplitude : 0
  }
}

const createRidged3d = (sample: NoiseFunction3D) => {
  return (
    x: number,
    y: number,
    z: number,
    octaves = 5,
    lacunarity = 2,
    gain = 0.5,
  ): number => {
    let amplitude = 1
    let frequency = 1
    let value = 0
    let totalAmplitude = 0

    for (let index = 0; index < octaves; index += 1) {
      const ridge = 1 - Math.abs(sample(x * frequency, y * frequency, z * frequency))
      value += ridge * ridge * amplitude
      totalAmplitude += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }

    return totalAmplitude > 0 ? value / totalAmplitude : 0
  }
}

export const createNoiseTools = (seedText: string) => {
  const seed = hashString(seedText)
  const value2d = createNoise2D(createSeededRandom(hashString(`${seedText}:2d`)))
  const value3d = createNoise3D(createSeededRandom(hashString(`${seedText}:3d`)))
  const fbm2d = createFbm2d(value2d)
  const fbm3d = createFbm3d(value3d)
  const ridged2d = createRidged2d(value2d)
  const ridged3d = createRidged3d(value3d)

  return { seed, value2d, fbm2d, ridged2d, value3d, fbm3d, ridged3d }
}
