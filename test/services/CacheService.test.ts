import { expect } from 'chai';
import { CacheService, MultiTierCache } from '../../src/services/CacheService';

describe('CacheService', () => {
  describe('basic get/set/delete', () => {
    it('returns undefined for a missing key', () => {
      const cache = new CacheService<string>({ maxSize: 5 });
      expect(cache.get('missing')).to.be.undefined;
    });

    it('round-trips string values', () => {
      const cache = new CacheService<string>();
      cache.set('k', 'v');
      expect(cache.get('k')).to.equal('v');
    });

    it('round-trips object values', () => {
      const cache = new CacheService<{ a: number }>();
      cache.set('k', { a: 1 });
      expect(cache.get('k')).to.deep.equal({ a: 1 });
    });

    it('updates an existing key without double-counting memory', () => {
      const cache = new CacheService<string>();
      cache.set('k', 'a');
      cache.set('k', 'bb');
      expect(cache.get('k')).to.equal('bb');
      // memoryUsage reflects only the latest value (2 chars × 2 bytes = 4)
      expect(cache.getStats().memoryUsage).to.equal(4);
    });

    it('returns false from delete for a missing key', () => {
      const cache = new CacheService<string>();
      expect(cache.delete('missing')).to.be.false;
    });

    it('returns true from delete for a present key and removes it', () => {
      const cache = new CacheService<string>();
      cache.set('k', 'v');
      expect(cache.delete('k')).to.be.true;
      expect(cache.get('k')).to.be.undefined;
    });

    it('clear empties the cache and resets memoryUsage', () => {
      const cache = new CacheService<string>();
      cache.set('a', 'x');
      cache.set('b', 'y');
      cache.clear();
      expect(cache.get('a')).to.be.undefined;
      expect(cache.getStats().size).to.equal(0);
      expect(cache.getStats().memoryUsage).to.equal(0);
    });
  });

  describe('TTL', () => {
    it('expired entries are dropped on get', () => {
      const cache = new CacheService<string>({ defaultTTL: 1 });
      cache.set('k', 'v');
      // Allow 1ms to elapse using a busy wait; avoid fake timers to keep dep count low.
      const start = Date.now();
      while (Date.now() - start < 3) { /* spin */ }
      expect(cache.get('k')).to.be.undefined;
    });

    it('honors a per-set TTL override', () => {
      const cache = new CacheService<string>({ defaultTTL: 1_000_000 });
      cache.set('k', 'v', 1);
      const start = Date.now();
      while (Date.now() - start < 3) { /* spin */ }
      expect(cache.get('k')).to.be.undefined;
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least-recently-used entry when maxSize is exceeded', () => {
      const cache = new CacheService<string>({ maxSize: 2, evictionPolicy: 'LRU' });
      cache.set('a', 'A');
      cache.set('b', 'B');
      cache.get('a'); // touch a → b is now LRU
      cache.set('c', 'C');
      expect(cache.get('b')).to.be.undefined;
      expect(cache.get('a')).to.equal('A');
      expect(cache.get('c')).to.equal('C');
    });
  });

  describe('LFU eviction', () => {
    it('evicts the least-frequently-used entry', () => {
      const cache = new CacheService<string>({ maxSize: 2, evictionPolicy: 'LFU' });
      cache.set('a', 'A');
      cache.set('b', 'B');
      cache.get('a'); cache.get('a'); cache.get('a');
      // b has 0 gets → is LFU
      cache.set('c', 'C');
      expect(cache.get('b')).to.be.undefined;
      expect(cache.get('a')).to.equal('A');
    });
  });

  describe('FIFO eviction', () => {
    it('evicts the first-inserted entry', () => {
      const cache = new CacheService<string>({ maxSize: 2, evictionPolicy: 'FIFO' });
      cache.set('a', 'A');
      cache.set('b', 'B');
      cache.get('a'); // even after get, FIFO ignores access
      cache.set('c', 'C');
      expect(cache.get('a')).to.be.undefined;
      expect(cache.get('b')).to.equal('B');
      expect(cache.get('c')).to.equal('C');
    });
  });

  describe('onEvict callback', () => {
    it('fires when an entry is evicted for capacity reasons', () => {
      const evicted: Array<{ key: string; value: string }> = [];
      const cache = new CacheService<string>({
        maxSize: 1,
        evictionPolicy: 'LRU',
        onEvict: (key, value) => { evicted.push({ key, value }); }
      });
      cache.set('a', 'A');
      cache.set('b', 'B'); // evicts 'a'
      expect(evicted).to.deep.equal([{ key: 'a', value: 'A' }]);
    });

    it('fires for every entry when clear() is called', () => {
      const evicted: string[] = [];
      const cache = new CacheService<string>({
        onEvict: (_key, value) => { evicted.push(value); }
      });
      cache.set('a', 'A');
      cache.set('b', 'B');
      cache.clear();
      expect(evicted.sort()).to.deep.equal(['A', 'B']);
    });
  });

  describe('getStats', () => {
    it('reports size, memoryUsage, and evictionPolicy', () => {
      const cache = new CacheService<string>({ evictionPolicy: 'FIFO' });
      cache.set('k', 'abcd');
      const stats = cache.getStats();
      expect(stats.size).to.equal(1);
      expect(stats.memoryUsage).to.equal(8); // 4 chars × 2 bytes
      expect(stats.evictionPolicy).to.equal('FIFO');
    });

    it('top-10 entries are sorted by access count', () => {
      const cache = new CacheService<string>();
      cache.set('a', 'A');
      cache.set('b', 'B');
      cache.get('b'); cache.get('b');
      const { entries } = cache.getStats();
      expect(entries[0]!.key).to.equal('b');
      expect(entries[0]!.accessCount).to.equal(2);
    });
  });
});

describe('MultiTierCache', () => {
  it('set to "warm" tier retrieves through get', () => {
    const cache = new MultiTierCache();
    cache.set('k', 'v', 'warm');
    expect(cache.get<string>('k')).to.equal('v');
  });

  it('set to "cold" tier retrieves through get', () => {
    const cache = new MultiTierCache();
    cache.set('k', 'v', 'cold');
    expect(cache.get<string>('k')).to.equal('v');
  });

  it('get promotes a cold entry toward a hotter tier', () => {
    const cache = new MultiTierCache();
    cache.set('k', 'v', 'cold');

    // After a get, the value should also be findable after we delete it from the cold tier
    // (because promotion should have copied it to the warm tier).
    expect(cache.get<string>('k')).to.equal('v');

    const stats = cache.getStats();
    const warm = stats.find(s => s.tier === 'warm')!;
    const cold = stats.find(s => s.tier === 'cold')!;
    expect(warm.stats.size).to.equal(1);
    expect(cold.stats.size).to.equal(1);
  });

  it('delete removes the key from every tier', () => {
    const cache = new MultiTierCache();
    cache.set('k', 'v', 'warm');
    cache.get<string>('k'); // promote to hot
    expect(cache.delete('k')).to.be.true;
    expect(cache.get<string>('k')).to.be.undefined;
  });

  it('delete returns false when key is not in any tier', () => {
    const cache = new MultiTierCache();
    expect(cache.delete('missing')).to.be.false;
  });

  it('clear empties every tier', () => {
    const cache = new MultiTierCache();
    cache.set('a', 'A', 'hot');
    cache.set('b', 'B', 'warm');
    cache.set('c', 'C', 'cold');
    cache.clear();
    expect(cache.get('a')).to.be.undefined;
    expect(cache.get('b')).to.be.undefined;
    expect(cache.get('c')).to.be.undefined;
  });

  it('getStats returns one entry per tier', () => {
    const cache = new MultiTierCache();
    const stats = cache.getStats();
    expect(stats.map(s => s.tier)).to.deep.equal(['hot', 'warm', 'cold']);
  });

  it('unknown importance falls back to the warm tier', () => {
    const cache = new MultiTierCache();
    cache.set('k', 'v', 'not-a-tier' as any);
    // Query before promotion so we know which tier actually owns it.
    const stats = cache.getStats();
    const warm = stats.find(s => s.tier === 'warm')!;
    expect(warm.stats.size).to.equal(1);
  });
});
