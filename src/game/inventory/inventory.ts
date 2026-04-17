import type { InventorySlot, ItemDefinition, NullableInventorySlot } from '../types'

export const cloneSlot = (slot: NullableInventorySlot): NullableInventorySlot =>
  slot ? { ...slot } : null

export const canStacksMerge = (
  left: NullableInventorySlot,
  right: NullableInventorySlot,
  items: Map<string, ItemDefinition>,
): boolean => {
  if (!left || !right) {
    return false
  }
  return left.itemId === right.itemId && left.durability === right.durability && Boolean(items.get(left.itemId))
}

export const getSlotCapacity = (
  itemId: string,
  items: Map<string, ItemDefinition>,
): number => items.get(itemId)?.stackSize ?? 64

export const addItemToSlot = (
  slot: NullableInventorySlot,
  incoming: InventorySlot,
  items: Map<string, ItemDefinition>,
): { slot: NullableInventorySlot; remainder: NullableInventorySlot } => {
  if (!slot) {
    const capacity = getSlotCapacity(incoming.itemId, items)
    if (incoming.count <= capacity) {
      return { slot: { ...incoming }, remainder: null }
    }
    return {
      slot: { ...incoming, count: capacity },
      remainder: { ...incoming, count: incoming.count - capacity },
    }
  }

  if (!canStacksMerge(slot, incoming, items)) {
    return { slot: { ...slot }, remainder: { ...incoming } }
  }

  const capacity = getSlotCapacity(slot.itemId, items)
  const available = capacity - slot.count
  if (available <= 0) {
    return { slot: { ...slot }, remainder: { ...incoming } }
  }

  const moved = Math.min(available, incoming.count)
  return {
    slot: { ...slot, count: slot.count + moved },
    remainder: incoming.count === moved ? null : { ...incoming, count: incoming.count - moved },
  }
}

export const addItemToCollection = (
  slots: NullableInventorySlot[],
  incoming: InventorySlot,
  items: Map<string, ItemDefinition>,
): NullableInventorySlot => {
  let remainder: NullableInventorySlot = { ...incoming }

  for (let index = 0; index < slots.length && remainder; index += 1) {
    if (!slots[index]) {
      continue
    }
    const result = addItemToSlot(slots[index], remainder, items)
    slots[index] = result.slot
    remainder = result.remainder
  }

  for (let index = 0; index < slots.length && remainder; index += 1) {
    if (slots[index]) {
      continue
    }
    const result = addItemToSlot(null, remainder, items)
    slots[index] = result.slot
    remainder = result.remainder
  }

  return remainder
}

export const removeItemCount = (
  slots: NullableInventorySlot[],
  itemId: string,
  count: number,
): number => {
  let remaining = count
  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const slot = slots[index]
    if (!slot || slot.itemId !== itemId) {
      continue
    }
    const removed = Math.min(slot.count, remaining)
    slot.count -= removed
    remaining -= removed
    if (slot.count <= 0) {
      slots[index] = null
    }
  }
  return count - remaining
}

export const splitStack = (slot: NullableInventorySlot): { left: NullableInventorySlot; right: NullableInventorySlot } => {
  if (!slot || slot.count <= 1) {
    return { left: cloneSlot(slot), right: null }
  }
  const rightCount = Math.floor(slot.count / 2)
  const leftCount = slot.count - rightCount
  return {
    left: { ...slot, count: leftCount },
    right: { ...slot, count: rightCount },
  }
}
