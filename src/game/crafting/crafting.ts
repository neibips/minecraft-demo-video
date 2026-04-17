import type {
  CraftMatch,
  InventorySlot,
  NullableInventorySlot,
  RecipeDefinition,
  ShapedRecipeDefinition,
  ShapelessRecipeDefinition,
} from '../types'

const trimPattern = (pattern: (string | null)[][]): (string | null)[][] => {
  let top = 0
  let bottom = pattern.length - 1
  let left = 0
  let right = pattern[0]?.length ? pattern[0].length - 1 : 0

  while (top <= bottom && pattern[top].every((cell) => cell == null)) {
    top += 1
  }
  while (bottom >= top && pattern[bottom].every((cell) => cell == null)) {
    bottom -= 1
  }
  while (left <= right && pattern.every((row) => row[left] == null)) {
    left += 1
  }
  while (right >= left && pattern.every((row) => row[right] == null)) {
    right -= 1
  }

  if (top > bottom || left > right) {
    return []
  }

  return pattern.slice(top, bottom + 1).map((row) => row.slice(left, right + 1))
}

const gridToPattern = (grid: NullableInventorySlot[], width: number, height: number): (string | null)[][] => {
  const rows: (string | null)[][] = []
  for (let y = 0; y < height; y += 1) {
    const row: (string | null)[] = []
    for (let x = 0; x < width; x += 1) {
      row.push(grid[y * width + x]?.itemId ?? null)
    }
    rows.push(row)
  }
  return trimPattern(rows)
}

const patternsEqual = (left: (string | null)[][], right: (string | null)[][]): boolean => {
  if (left.length !== right.length) {
    return false
  }
  for (let y = 0; y < left.length; y += 1) {
    if (left[y].length !== right[y].length) {
      return false
    }
    for (let x = 0; x < left[y].length; x += 1) {
      if (left[y][x] !== right[y][x]) {
        return false
      }
    }
  }
  return true
}

const matchesShaped = (
  recipe: ShapedRecipeDefinition,
  grid: NullableInventorySlot[],
  width: number,
  height: number,
): boolean => {
  const input = gridToPattern(grid, width, height)
  const recipePattern = trimPattern(recipe.pattern)
  return patternsEqual(input, recipePattern)
}

const matchesShapeless = (
  recipe: ShapelessRecipeDefinition,
  grid: NullableInventorySlot[],
): boolean => {
  const ingredients = grid
    .filter((slot): slot is InventorySlot => Boolean(slot))
    .map((slot) => slot.itemId)
    .sort()
  const recipeIngredients = [...recipe.ingredients].sort()
  if (ingredients.length !== recipeIngredients.length) {
    return false
  }
  return ingredients.every((itemId, index) => itemId === recipeIngredients[index])
}

export const findCraftMatch = (
  recipes: Iterable<RecipeDefinition>,
  grid: NullableInventorySlot[],
  width: number,
  height: number,
): CraftMatch | null => {
  for (const recipe of recipes) {
    if (recipe.type === 'smelting') {
      continue
    }
    const matches =
      recipe.type === 'shaped'
        ? matchesShaped(recipe, grid, width, height)
        : matchesShapeless(recipe, grid)
    if (matches) {
      return {
        recipe,
        result: {
          itemId: recipe.result.item,
          count: recipe.result.count,
        },
      }
    }
  }
  return null
}

export const consumeCraftIngredients = (
  recipe: RecipeDefinition,
  grid: NullableInventorySlot[],
): void => {
  if (recipe.type === 'shapeless') {
    for (let index = 0; index < grid.length; index += 1) {
      const slot = grid[index]
      if (!slot) {
        continue
      }
      slot.count -= 1
      if (slot.count <= 0) {
        grid[index] = null
      }
    }
    return
  }

  if (recipe.type === 'shaped') {
    for (let index = 0; index < grid.length; index += 1) {
      const slot = grid[index]
      if (!slot) {
        continue
      }
      slot.count -= 1
      if (slot.count <= 0) {
        grid[index] = null
      }
    }
  }
}

export const findSmeltingRecipe = (
  recipes: Iterable<RecipeDefinition>,
  itemId: string,
): RecipeDefinition | null => {
  for (const recipe of recipes) {
    if (recipe.type === 'smelting' && recipe.input === itemId) {
      return recipe
    }
  }
  return null
}
