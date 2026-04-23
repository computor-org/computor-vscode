interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
  size?: number;
}

export type EvictionPolicy = 'LRU' | 'LFU' | 'FIFO' | 'TTL';

interface CacheConfig {
  maxSize?: number;
  maxMemory?: number; // in bytes
  defaultTTL?: number; // in milliseconds
  evictionPolicy?: EvictionPolicy;
  onEvict?: (key: string, value: any) => void;
}

export class CacheService<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private accessOrder: string[] = []; // For LRU
  private insertionOrder: string[] = []; // For FIFO
  private currentMemory: number = 0;
  
  private readonly config: Required<CacheConfig> = {
    maxSize: 1000,
    maxMemory: 50 * 1024 * 1024, // 50MB default
    defaultTTL: 5 * 60 * 1000, // 5 minutes default
    evictionPolicy: 'LRU',
    onEvict: () => {}
  };
  
  constructor(config?: CacheConfig) {
    this.config = { ...this.config, ...config };
    
    // Start cleanup interval
    this.startCleanupInterval();
  }
  
  /**
   * Get item from cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }
    
    // Check if expired
    if (this.isExpired(entry)) {
      this.delete(key);
      return undefined;
    }
    
    // Update access information
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    
    // Update LRU order
    if (this.config.evictionPolicy === 'LRU') {
      this.updateLRUOrder(key);
    }
    
    return entry.data;
  }
  
  /**
   * Set item in cache
   */
  set(key: string, value: T, ttl?: number): void {
    const size = this.estimateSize(value);
    const entry: CacheEntry<T> = {
      data: value,
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultTTL,
      accessCount: 0,
      lastAccessed: Date.now(),
      size
    };
    
    // Check if we need to evict items
    if (this.cache.has(key)) {
      // Update existing entry
      const oldEntry = this.cache.get(key)!;
      this.currentMemory -= oldEntry.size || 0;
    } else {
      // New entry - check capacity
      this.ensureCapacity(size);
      this.insertionOrder.push(key);
    }
    
    this.cache.set(key, entry);
    this.currentMemory += size;
    
    // Update LRU order
    if (this.config.evictionPolicy === 'LRU') {
      this.updateLRUOrder(key);
    }
  }
  
  /**
   * Delete item from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (entry) {
      this.currentMemory -= entry.size || 0;
      this.cache.delete(key);
      
      // Remove from tracking arrays
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      this.insertionOrder = this.insertionOrder.filter(k => k !== key);
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Clear all cache
   */
  clear(): void {
    for (const [key, entry] of this.cache.entries()) {
      this.config.onEvict(key, entry.data);
    }
    
    this.cache.clear();
    this.accessOrder = [];
    this.insertionOrder = [];
    this.currentMemory = 0;
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    memoryUsage: number;
    hitRate: number;
    evictionPolicy: EvictionPolicy;
    entries: Array<{ key: string; size?: number; accessCount: number; age: number }>;
  } {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      size: entry.size,
      accessCount: entry.accessCount,
      age: Date.now() - entry.timestamp
    }));
    
    const totalAccess = entries.reduce((sum, e) => sum + e.accessCount, 0);
    const hitRate = this.cache.size > 0 ? totalAccess / this.cache.size : 0;
    
    return {
      size: this.cache.size,
      memoryUsage: this.currentMemory,
      hitRate,
      evictionPolicy: this.config.evictionPolicy,
      entries: entries.sort((a, b) => b.accessCount - a.accessCount).slice(0, 10)
    };
  }
  
  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }
  
  /**
   * Estimate size of value in bytes
   */
  private estimateSize(value: any): number {
    if (value === null || value === undefined) {
      return 0;
    }
    
    if (typeof value === 'string') {
      return value.length * 2; // 2 bytes per character
    }
    
    if (typeof value === 'number') {
      return 8;
    }
    
    if (typeof value === 'boolean') {
      return 4;
    }
    
    if (typeof value === 'object') {
      try {
        const json = JSON.stringify(value);
        return json.length * 2;
      } catch {
        return 1024; // Default 1KB for objects that can't be stringified
      }
    }
    
    return 256; // Default size
  }
  
  /**
   * Ensure cache capacity by evicting items if necessary
   */
  private ensureCapacity(requiredSize: number): void {
    // Check size limit
    while (this.cache.size >= this.config.maxSize) {
      this.evictOne();
    }
    
    // Check memory limit
    while (this.currentMemory + requiredSize > this.config.maxMemory) {
      if (!this.evictOne()) {
        break; // No more items to evict
      }
    }
  }
  
  /**
   * Evict one item based on eviction policy
   */
  private evictOne(): boolean {
    let keyToEvict: string | undefined;
    
    switch (this.config.evictionPolicy) {
      case 'LRU':
        keyToEvict = this.accessOrder[0];
        break;
        
      case 'LFU':
        keyToEvict = this.findLFUKey();
        break;
        
      case 'FIFO':
        keyToEvict = this.insertionOrder[0];
        break;
        
      case 'TTL':
        keyToEvict = this.findOldestKey();
        break;
    }
    
    if (keyToEvict) {
      const entry = this.cache.get(keyToEvict);
      if (entry) {
        this.config.onEvict(keyToEvict, entry.data);
      }
      this.delete(keyToEvict);
      return true;
    }
    
    return false;
  }
  
  /**
   * Update LRU access order
   */
  private updateLRUOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }
  
  /**
   * Find least frequently used key
   */
  private findLFUKey(): string | undefined {
    let minAccess = Infinity;
    let lfuKey: string | undefined;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessCount < minAccess) {
        minAccess = entry.accessCount;
        lfuKey = key;
      }
    }
    
    return lfuKey;
  }
  
  /**
   * Find oldest key by timestamp
   */
  private findOldestKey(): string | undefined {
    let oldestTime = Infinity;
    let oldestKey: string | undefined;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    return oldestKey;
  }
  
  /**
   * Start cleanup interval for expired entries
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      for (const [key, entry] of this.cache.entries()) {
        if (this.isExpired(entry)) {
          this.delete(key);
        }
      }
    }, 60000); // Clean up every minute
  }
}

/**
 * Multi-tier cache with different policies per tier
 */
export class MultiTierCache {
  private tiers: Array<{
    name: string;
    cache: CacheService;
    priority: number;
  }> = [];
  
  constructor() {
    // L1: Hot cache - small, fast, LRU
    this.addTier('hot', new CacheService({
      maxSize: 100,
      maxMemory: 5 * 1024 * 1024, // 5MB
      defaultTTL: 60000, // 1 minute
      evictionPolicy: 'LRU'
    }), 1);
    
    // L2: Warm cache - medium, balanced
    this.addTier('warm', new CacheService({
      maxSize: 500,
      maxMemory: 20 * 1024 * 1024, // 20MB
      defaultTTL: 5 * 60000, // 5 minutes
      evictionPolicy: 'LFU'
    }), 2);
    
    // L3: Cold cache - large, persistent
    this.addTier('cold', new CacheService({
      maxSize: 2000,
      maxMemory: 50 * 1024 * 1024, // 50MB
      defaultTTL: 30 * 60000, // 30 minutes
      evictionPolicy: 'FIFO'
    }), 3);
  }
  
  /**
   * Add a cache tier
   */
  addTier(name: string, cache: CacheService, priority: number): void {
    this.tiers.push({ name, cache, priority });
    this.tiers.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Get from multi-tier cache
   */
  get<T>(key: string): T | undefined {
    for (const tier of this.tiers) {
      const value = tier.cache.get(key);
      
      if (value !== undefined) {
        // Promote to higher tier if accessed frequently
        if (tier.priority > 1) {
          const higherTier = this.tiers[tier.priority - 2];
          if (higherTier) {
            higherTier.cache.set(key, value);
          }
        }
        
        return value as T;
      }
    }
    
    return undefined;
  }
  
  /**
   * Set in appropriate tier based on importance
   */
  set<T>(key: string, value: T, importance: 'hot' | 'warm' | 'cold' = 'warm'): void {
    const tier = this.tiers.find(t => t.name === importance) || this.tiers[1];
    if (tier) {
      tier.cache.set(key, value);
    }
  }
  
  /**
   * Delete item from all tiers
   */
  delete(key: string): boolean {
    let deleted = false;
    for (const tier of this.tiers) {
      if (tier.cache.delete(key)) {
        deleted = true;
      }
    }
    return deleted;
  }
  
  /**
   * Clear all tiers
   */
  clear(): void {
    for (const tier of this.tiers) {
      tier.cache.clear();
    }
  }
  
  /**
   * Get statistics for all tiers
   */
  getStats(): Array<{ tier: string; stats: ReturnType<CacheService['getStats']> }> {
    return this.tiers.map(tier => ({
      tier: tier.name,
      stats: tier.cache.getStats()
    }));
  }
}

// Export singleton instance
export const multiTierCache = new MultiTierCache();