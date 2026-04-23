import * as vscode from 'vscode';

export interface VirtualScrollConfig {
  pageSize: number;
  preloadPages: number;
  maxCachedPages: number;
  enablePrefetch: boolean;
}

export interface VirtualPage<T> {
  pageNumber: number;
  items: T[];
  totalItems: number;
  totalPages: number;
  isLoaded: boolean;
  isLoading: boolean;
  timestamp: number;
}

export interface VirtualScrollState<T> {
  pages: Map<number, VirtualPage<T>>;
  currentPage: number;
  totalItems: number;
  totalPages: number;
  config: VirtualScrollConfig;
}

export class VirtualScrollingService<T> {
  private state: VirtualScrollState<T>;
  private loadFunction: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>;
  private onDataChanged: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeData: vscode.Event<void> = this.onDataChanged.event;
  
  constructor(
    loadFunction: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
    config?: Partial<VirtualScrollConfig>
  ) {
    this.loadFunction = loadFunction;
    this.state = {
      pages: new Map(),
      currentPage: 0,
      totalItems: 0,
      totalPages: 0,
      config: {
        pageSize: config?.pageSize || 50,
        preloadPages: config?.preloadPages || 2,
        maxCachedPages: config?.maxCachedPages || 10,
        enablePrefetch: config?.enablePrefetch !== false,
        ...config
      }
    };
  }
  
  /**
   * Get items for display with virtual scrolling
   */
  async getItems(startIndex: number, count: number): Promise<T[]> {
    const { pageSize } = this.state.config;
    const startPage = Math.floor(startIndex / pageSize);
    const endPage = Math.floor((startIndex + count - 1) / pageSize);
    
    const items: T[] = [];
    
    // Load required pages
    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      const page = await this.loadPage(pageNum);
      
      if (page && page.items.length > 0) {
        const pageStartIndex = pageNum * pageSize;
        void (pageStartIndex + page.items.length); // pageEndIndex - not used
        
        // Calculate which items from this page we need
        const itemStartIndex = Math.max(0, startIndex - pageStartIndex);
        const itemEndIndex = Math.min(page.items.length, startIndex + count - pageStartIndex);
        
        if (itemEndIndex > itemStartIndex) {
          items.push(...page.items.slice(itemStartIndex, itemEndIndex));
        }
      }
    }
    
    // Prefetch adjacent pages if enabled
    if (this.state.config.enablePrefetch) {
      this.prefetchAdjacentPages(startPage, endPage);
    }
    
    // Clean up old cached pages
    this.evictOldPages();
    
    return items;
  }
  
  /**
   * Load a specific page
   */
  private async loadPage(pageNumber: number): Promise<VirtualPage<T> | undefined> {
    // Check if page is already loaded or loading
    let page = this.state.pages.get(pageNumber);
    
    if (page?.isLoaded) {
      // Update timestamp for LRU
      page.timestamp = Date.now();
      return page;
    }
    
    if (page?.isLoading) {
      // Wait for loading to complete
      return this.waitForPageLoad(pageNumber);
    }
    
    // Create page entry and start loading
    page = {
      pageNumber,
      items: [],
      totalItems: 0,
      totalPages: 0,
      isLoaded: false,
      isLoading: true,
      timestamp: Date.now()
    };
    
    this.state.pages.set(pageNumber, page);
    
    try {
      const result = await this.loadFunction(pageNumber, this.state.config.pageSize);
      
      // Update page with loaded data
      page.items = result.items;
      page.totalItems = result.total;
      page.totalPages = Math.ceil(result.total / this.state.config.pageSize);
      page.isLoaded = true;
      page.isLoading = false;
      
      // Update global state
      this.state.totalItems = result.total;
      this.state.totalPages = page.totalPages;
      
      return page;
    } catch (error) {
      // Remove failed page from cache
      this.state.pages.delete(pageNumber);
      console.error(`Failed to load page ${pageNumber}:`, error);
      return undefined;
    }
  }
  
  /**
   * Wait for a page that's currently loading
   */
  private async waitForPageLoad(pageNumber: number, maxWait: number = 5000): Promise<VirtualPage<T> | undefined> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const page = this.state.pages.get(pageNumber);
      
      if (page?.isLoaded) {
        return page;
      }
      
      if (!page?.isLoading) {
        // Page failed to load
        return undefined;
      }
      
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Timeout
    return undefined;
  }
  
  /**
   * Prefetch adjacent pages for smoother scrolling
   */
  private async prefetchAdjacentPages(startPage: number, endPage: number): Promise<void> {
    const { preloadPages } = this.state.config;
    const pagesToPrefetch: number[] = [];
    
    // Pages before current range
    for (let i = 1; i <= preloadPages; i++) {
      const pageNum = startPage - i;
      if (pageNum >= 0 && !this.state.pages.has(pageNum)) {
        pagesToPrefetch.push(pageNum);
      }
    }
    
    // Pages after current range
    for (let i = 1; i <= preloadPages; i++) {
      const pageNum = endPage + i;
      if (!this.state.pages.has(pageNum)) {
        pagesToPrefetch.push(pageNum);
      }
    }
    
    // Load pages in background (don't await)
    pagesToPrefetch.forEach(pageNum => {
      this.loadPage(pageNum).catch(err => {
        console.warn(`Failed to prefetch page ${pageNum}:`, err);
      });
    });
  }
  
  /**
   * Evict old pages from cache to manage memory
   */
  private evictOldPages(): void {
    const { maxCachedPages } = this.state.config;
    
    if (this.state.pages.size <= maxCachedPages) {
      return;
    }
    
    // Sort pages by timestamp (LRU)
    const sortedPages = Array.from(this.state.pages.entries())
      .filter(([_, page]) => page.isLoaded && !page.isLoading)
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    // Remove oldest pages
    const pagesToRemove = sortedPages.slice(0, this.state.pages.size - maxCachedPages);
    
    for (const [pageNum] of pagesToRemove) {
      this.state.pages.delete(pageNum);
    }
  }
  
  /**
   * Reset the virtual scrolling state
   */
  reset(): void {
    this.state.pages.clear();
    this.state.currentPage = 0;
    this.state.totalItems = 0;
    this.state.totalPages = 0;
    this.onDataChanged.fire();
  }
  
  /**
   * Invalidate specific pages
   */
  invalidatePages(pageNumbers: number[]): void {
    for (const pageNum of pageNumbers) {
      this.state.pages.delete(pageNum);
    }
    this.onDataChanged.fire();
  }
  
  /**
   * Get current state information
   */
  getState(): {
    loadedPages: number;
    totalPages: number;
    totalItems: number;
    cacheSize: number;
  } {
    return {
      loadedPages: Array.from(this.state.pages.values()).filter(p => p.isLoaded).length,
      totalPages: this.state.totalPages,
      totalItems: this.state.totalItems,
      cacheSize: this.state.pages.size
    };
  }
  
  /**
   * Create a virtual tree data provider wrapper
   */
  createTreeDataProvider<TItem extends vscode.TreeItem>(
    originalProvider: vscode.TreeDataProvider<TItem>,
    getItemCount: (element?: TItem) => Promise<number>
  ): vscode.TreeDataProvider<TItem> {
    const virtualProvider: vscode.TreeDataProvider<TItem> = {
      onDidChangeTreeData: originalProvider.onDidChangeTreeData,
      
      getTreeItem: (element: TItem) => {
        return originalProvider.getTreeItem(element);
      },
      
      getChildren: async (element?: TItem): Promise<TItem[] | undefined> => {
        if (!element) {
          // Root level - use original provider
          const result = await originalProvider.getChildren?.(element);
          return result === null ? undefined : result;
        }
        
        // Get total count for this element
        const totalCount = await getItemCount(element);
        
        if (totalCount <= this.state.config.pageSize) {
          // Small dataset - use original provider
          const result = await originalProvider.getChildren?.(element);
          return result === null ? undefined : result;
        }
        
        // Large dataset - use virtual scrolling
        const virtualService = new VirtualScrollingService<TItem>(
          async (page, pageSize) => {
            const start = page * pageSize;
            const items = await originalProvider.getChildren?.(element) || [];
            const pageItems = items.slice(start, start + pageSize);
            
            return {
              items: pageItems,
              total: totalCount
            };
          },
          this.state.config
        );
        
        // Return first page with load more indicator
        const firstPageItems = await virtualService.getItems(0, this.state.config.pageSize);
        
        if (totalCount > firstPageItems.length) {
          // Add a "Load More" item
          const loadMoreItem = {
            label: `Load more (${totalCount - firstPageItems.length} remaining)`,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
              command: 'computor.loadMoreVirtualItems',
              title: 'Load More',
              arguments: [element, virtualService]
            }
          } as any as TItem;
          
          return [...firstPageItems, loadMoreItem];
        }
        
        return firstPageItems;
      },
      
      getParent: originalProvider.getParent?.bind(originalProvider),
      
      resolveTreeItem: originalProvider.resolveTreeItem?.bind(originalProvider)
    };
    
    return virtualProvider;
  }
}

