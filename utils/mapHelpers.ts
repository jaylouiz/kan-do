/**
 * Utility functions for Map-like operations on Record types
 * 
 * This replaces Map/Set usage with Record/Array for better TypeScript inference
 * and simpler persistence with pinia-plugin-persistedstate
 */

// Utility for Map-like operations on Records
export interface MapLikeRecord<T> {
  [key: string]: T
}

export const mapHelpers = {
  /**
   * Set a value in a Record (like Map.set())
   */
  set<T>(record: MapLikeRecord<T>, key: string, value: T): void {
    record[key] = value
  },
  
  /**
   * Get a value from a Record (like Map.get())
   */
  get<T>(record: MapLikeRecord<T>, key: string): T | undefined {
    return record[key]
  },
  
  /**
   * Check if key exists in Record (like Map.has())
   */
  has<T>(record: MapLikeRecord<T>, key: string): boolean {
    return key in record
  },
  
  /**
   * Delete a key from Record (like Map.delete())
   */
  delete<T>(record: MapLikeRecord<T>, key: string): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete record[key]
  },
  
  /**
   * Get number of keys in Record (like Map.size)
   */
  size<T>(record: MapLikeRecord<T>): number {
    return Object.keys(record).length
  },
  
  /**
   * Get all entries as array (like Map.entries())
   */
  entries<T>(record: MapLikeRecord<T>): [string, T][] {
    return Object.entries(record)
  },
  
  /**
   * Get all values as array (like Map.values())
   */
  values<T>(record: MapLikeRecord<T>): T[] {
    return Object.values(record)
  },
  
  /**
   * Get all keys as array (like Map.keys())
   */
  keys<T>(record: MapLikeRecord<T>): string[] {
    return Object.keys(record)
  },
  
  /**
   * Clear all entries from Record (like Map.clear())
   */
  clear<T>(_record: MapLikeRecord<T>): MapLikeRecord<T> {
    return {}
  },
  
  /**
   * Iterate over each entry (like Map.forEach())
   */
  forEach<T>(record: MapLikeRecord<T>, callback: (value: T, key: string) => void): void {
    Object.entries(record).forEach(([key, value]) => {
      callback(value, key)
    })
  }
}

// Utility for Set-like operations on Arrays
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SetLikeArray<T> extends Array<T> {}

export const setHelpers = {
  /**
   * Add value to array set (like Set.add())
   */
  add<T>(array: SetLikeArray<T>, value: T): SetLikeArray<T> {
    if (!array.includes(value)) {
      array.push(value)
    }
    return array
  },
  
  /**
   * Check if value exists in array set (like Set.has())
   */
  has<T>(array: SetLikeArray<T>, value: T): boolean {
    return array.includes(value)
  },
  
  /**
   * Remove value from array set (like Set.delete())
   */
  delete<T>(array: SetLikeArray<T>, value: T): boolean {
    const index = array.indexOf(value)
    if (index > -1) {
      array.splice(index, 1)
      return true
    }
    return false
  },
  
  /**
   * Get size of array set (like Set.size)
   */
  size<T>(array: SetLikeArray<T>): number {
    return array.length
  },
  
  /**
   * Clear all values from array set (like Set.clear())
   */
  clear<T>(): SetLikeArray<T> {
    return []
  },
  
  /**
   * Convert array to unique values (like new Set())
   */
  unique<T>(array: T[]): SetLikeArray<T> {
    return [...new Set(array)]
  }
}
