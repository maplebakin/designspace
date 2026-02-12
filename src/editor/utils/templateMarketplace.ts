/**
 * templateMarketplace - Template and asset marketplace
 * Implements Task 16: Build template and asset marketplace
 */

import * as fabric from 'fabric';
import { Template } from '../state/editorStore';

export interface MarketplaceAsset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  category: string;
  author: string;
  rating: number; // 0-5
  downloads: number;
  thumbnailUrl: string;
  previewUrl?: string;
  fileUrl: string;
  fileType: 'template' | 'sticker' | 'font' | 'color-palette' | 'icon';
  license: 'free' | 'premium' | 'creative-commons';
  createdAt: Date;
  updatedAt: Date;
  fileSize: number; // in bytes
  isFeatured?: boolean;
  isVerified?: boolean;
}

export interface MarketplaceCategory {
  id: string;
  name: string;
  icon: string;
  count: number;
  parentCategory?: string;
}

export interface SearchFilters {
  query?: string;
  categories?: string[];
  tags?: string[];
  license?: ('free' | 'premium' | 'creative-commons')[];
  sortBy?: 'popularity' | 'newest' | 'rating' | 'downloads';
  premiumOnly?: boolean;
  verifiedOnly?: boolean;
}

export interface MarketplaceConfig {
  apiUrl: string;
  apiKey?: string;
  featuredLimit: number;
  recentlyAddedLimit: number;
  searchResultsLimit: number;
}

export class TemplateMarketplace {
  private static instance: TemplateMarketplace;
  private config: MarketplaceConfig;
  private cachedAssets: Map<string, MarketplaceAsset> = new Map();
  private cachedCategories: MarketplaceCategory[] = [];
  private searchCache: Map<string, MarketplaceAsset[]> = new Map();

  static getInstance(): TemplateMarketplace {
    if (!TemplateMarketplace.instance) {
      TemplateMarketplace.instance = new TemplateMarketplace();
    }
    return TemplateMarketplace.instance;
  }

  constructor(config?: Partial<MarketplaceConfig>) {
    this.config = {
      apiUrl: config?.apiUrl || 'https://api.designspace.com/marketplace',
      apiKey: config?.apiKey,
      featuredLimit: config?.featuredLimit || 12,
      recentlyAddedLimit: config?.recentlyAddedLimit || 20,
      searchResultsLimit: config?.searchResultsLimit || 50,
    };
  }

  /**
   * Get featured assets
   */
  async getFeaturedAssets(): Promise<MarketplaceAsset[]> {
    // Check cache first
    const cacheKey = 'featured';
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // In a real implementation, this would fetch from an API
      // For now, return mock data
      const featuredAssets: MarketplaceAsset[] = [
        {
          id: 'feat-template-1',
          name: 'Business Card Template',
          description: 'Professional business card template with modern design',
          tags: ['business', 'card', 'professional'],
          category: 'templates',
          author: 'DesignPro Studio',
          rating: 4.7,
          downloads: 12450,
          thumbnailUrl: 'https://example.com/thumbnails/business-card.jpg',
          fileUrl: 'https://example.com/templates/business-card.apocatemplate',
          fileType: 'template',
          license: 'free',
          createdAt: new Date('2023-05-15'),
          updatedAt: new Date('2023-06-20'),
          fileSize: 2457600,
          isFeatured: true,
          isVerified: true
        },
        {
          id: 'feat-sticker-1',
          name: 'Nature Stickers Pack',
          description: 'Beautiful nature-themed stickers for designs',
          tags: ['nature', 'stickers', 'illustration'],
          category: 'stickers',
          author: 'ArtWorld',
          rating: 4.9,
          downloads: 8765,
          thumbnailUrl: 'https://example.com/thumbnails/nature-stickers.jpg',
          fileUrl: 'https://example.com/stickers/nature-pack.apocasticker',
          fileType: 'sticker',
          license: 'premium',
          createdAt: new Date('2023-07-10'),
          updatedAt: new Date('2023-07-10'),
          fileSize: 5120000,
          isFeatured: true,
          isVerified: true
        }
      ];

      this.searchCache.set(cacheKey, featuredAssets);
      return featuredAssets;
    } catch (error) {
      console.error('Error fetching featured assets:', error);
      return [];
    }
  }

  /**
   * Get recently added assets
   */
  async getRecentlyAdded(): Promise<MarketplaceAsset[]> {
    // Check cache first
    const cacheKey = 'recent';
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Mock implementation
      const recentAssets: MarketplaceAsset[] = [
        {
          id: 'recent-template-1',
          name: 'Social Media Post Template',
          description: 'Instagram and Facebook post templates',
          tags: ['social', 'media', 'instagram', 'facebook'],
          category: 'templates',
          author: 'SocialDesigns',
          rating: 4.5,
          downloads: 3421,
          thumbnailUrl: 'https://example.com/thumbnails/social-post.jpg',
          fileUrl: 'https://example.com/templates/social-post.apocatemplate',
          fileType: 'template',
          license: 'free',
          createdAt: new Date(),
          updatedAt: new Date(),
          fileSize: 3072000,
          isVerified: true
        }
      ];

      this.searchCache.set(cacheKey, recentAssets);
      return recentAssets;
    } catch (error) {
      console.error('Error fetching recently added assets:', error);
      return [];
    }
  }

  /**
   * Search for assets
   */
  async searchAssets(filters: SearchFilters): Promise<MarketplaceAsset[]> {
    const cacheKey = JSON.stringify(filters);
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // In a real implementation, this would call an API
      // For now, return mock data based on filters
      let results: MarketplaceAsset[] = [];

      // Mock data - in reality this would come from an API
      const allAssets: MarketplaceAsset[] = [
        {
          id: 'search-result-1',
          name: 'Brochure Template',
          description: 'Tri-fold brochure template for marketing',
          tags: ['brochure', 'marketing', 'print'],
          category: 'templates',
          author: 'PrintMaster',
          rating: 4.3,
          downloads: 5678,
          thumbnailUrl: 'https://example.com/thumbnails/brochure.jpg',
          fileUrl: 'https://example.com/templates/brochure.apocatemplate',
          fileType: 'template',
          license: 'premium',
          createdAt: new Date('2023-03-12'),
          updatedAt: new Date('2023-04-18'),
          fileSize: 4096000,
          isVerified: true
        },
        {
          id: 'search-result-2',
          name: 'Icon Set - Tech',
          description: 'Technology-themed icon set',
          tags: ['icons', 'tech', 'ui'],
          category: 'icons',
          author: 'IconFactory',
          rating: 4.8,
          downloads: 9876,
          thumbnailUrl: 'https://example.com/thumbnails/tech-icons.jpg',
          fileUrl: 'https://example.com/icons/tech-set.apocaicon',
          fileType: 'icon',
          license: 'free',
          createdAt: new Date('2023-06-05'),
          updatedAt: new Date('2023-06-05'),
          fileSize: 1024000,
          isVerified: true
        }
      ];

      // Apply filters
      results = allAssets.filter(asset => {
        // Query filter
        if (filters.query) {
          const query = filters.query.toLowerCase();
          if (
            !asset.name.toLowerCase().includes(query) &&
            !asset.description.toLowerCase().includes(query) &&
            !asset.tags.some(tag => tag.toLowerCase().includes(query))
          ) {
            return false;
          }
        }

        // Category filter
        if (filters.categories && filters.categories.length > 0) {
          if (!filters.categories.includes(asset.category)) {
            return false;
          }
        }

        // License filter
        if (filters.license && filters.license.length > 0) {
          if (!filters.license.includes(asset.license)) {
            return false;
          }
        }

        // Premium only filter
        if (filters.premiumOnly && asset.license === 'free') {
          return false;
        }

        // Verified only filter
        if (filters.verifiedOnly && !asset.isVerified) {
          return false;
        }

        return true;
      });

      // Apply sorting
      if (filters.sortBy) {
        switch (filters.sortBy) {
          case 'popularity':
            results.sort((a, b) => b.downloads - a.downloads);
            break;
          case 'newest':
            results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            break;
          case 'rating':
            results.sort((a, b) => b.rating - a.rating);
            break;
          case 'downloads':
            results.sort((a, b) => b.downloads - a.downloads);
            break;
        }
      }

      // Apply limit
      results = results.slice(0, this.config.searchResultsLimit);

      this.searchCache.set(cacheKey, results);
      return results;
    } catch (error) {
      console.error('Error searching assets:', error);
      return [];
    }
  }

  /**
   * Get asset by ID
   */
  async getAssetById(id: string): Promise<MarketplaceAsset | null> {
    const cached = this.cachedAssets.get(id);
    if (cached) {
      return cached;
    }

    try {
      // In a real implementation, this would fetch from an API
      // For now, return null (would be implemented with API call)
      return null;
    } catch (error) {
      console.error(`Error fetching asset with ID ${id}:`, error);
      return null;
    }
  }

  /**
   * Get all categories
   */
  async getCategories(): Promise<MarketplaceCategory[]> {
    if (this.cachedCategories.length > 0) {
      return this.cachedCategories;
    }

    try {
      // Mock categories
      const categories: MarketplaceCategory[] = [
        { id: 'templates', name: 'Templates', icon: '📄', count: 1245 },
        { id: 'stickers', name: 'Stickers', icon: '🏷️', count: 876 },
        { id: 'icons', name: 'Icons', icon: '⭐', count: 2341 },
        { id: 'fonts', name: 'Fonts', icon: '🔤', count: 567 },
        { id: 'palettes', name: 'Color Palettes', icon: '🎨', count: 321 },
        { id: 'textures', name: 'Textures', icon: '🧵', count: 445 },
        { id: 'frames', name: 'Frames', icon: '🖼️', count: 678 },
        { id: 'shapes', name: 'Shapes', icon: '🔷', count: 987 }
      ];

      this.cachedCategories = categories;
      return categories;
    } catch (error) {
      console.error('Error fetching categories:', error);
      return [];
    }
  }

  /**
   * Download asset
   */
  async downloadAsset(assetId: string): Promise<Blob | null> {
    try {
      const asset = await this.getAssetById(assetId);
      if (!asset) {
        console.error(`Asset with ID ${assetId} not found`);
        return null;
      }

      // In a real implementation, this would download from the asset.fileUrl
      // For now, we'll simulate the download
      console.log(`Downloading asset: ${asset.name} from ${asset.fileUrl}`);
      
      // Simulate fetch
      const response = await fetch(asset.fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download asset: ${response.statusText}`);
      }
      
      return await response.blob();
    } catch (error) {
      console.error(`Error downloading asset with ID ${assetId}:`, error);
      return null;
    }
  }

  /**
   * Install asset to local library
   */
  async installAsset(assetId: string, canvas?: fabric.Canvas): Promise<boolean> {
    try {
      const blob = await this.downloadAsset(assetId);
      if (!blob) {
        return false;
      }

      const asset = await this.getAssetById(assetId);
      if (!asset) {
        return false;
      }

      // Process the asset based on its type
      switch (asset.fileType) {
        case 'template':
          // Load template into editor
          if (canvas) {
            // In a real implementation, this would load the template into the canvas
            console.log(`Installing template: ${asset.name}`);
            return true;
          }
          break;
          
        case 'sticker':
          // Add sticker to asset library
          console.log(`Adding sticker to library: ${asset.name}`);
          return true;
          
        case 'icon':
          // Add icon to icon library
          console.log(`Adding icon to library: ${asset.name}`);
          return true;
          
        case 'font':
          // Add font to font library (would require font loading)
          console.log(`Adding font to library: ${asset.name}`);
          return true;
          
        case 'color-palette':
          // Add color palette to theme system
          console.log(`Adding color palette to themes: ${asset.name}`);
          return true;
      }

      return false;
    } catch (error) {
      console.error(`Error installing asset with ID ${assetId}:`, error);
      return false;
    }
  }

  /**
   * Upload asset to marketplace (for creators)
   */
  async uploadAsset(
    _file: File,
    metadata: Omit<MarketplaceAsset, 'id' | 'author' | 'rating' | 'downloads' | 'createdAt' | 'updatedAt'>
  ): Promise<string | null> {
    try {
      // In a real implementation, this would upload to the marketplace API
      // For now, return a mock asset ID
      console.log(`Uploading asset: ${metadata.name}`);
      
      // Would typically send a multipart form request with file and metadata
      // const formData = new FormData();
      // formData.append('file', file);
      // formData.append('metadata', JSON.stringify(metadata));
      // 
      // const response = await fetch(`${this.config.apiUrl}/upload`, {
      //   method: 'POST',
      //   body: formData,
      //   headers: this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}
      // });
      // 
      // if (!response.ok) {
      //   throw new Error(`Upload failed: ${response.statusText}`);
      // }
      // 
      // const result = await response.json();
      // return result.assetId;

      // For demo purposes, return a mock ID
      return `mock-asset-${Date.now()}`;
    } catch (error) {
      console.error('Error uploading asset:', error);
      return null;
    }
  }

  /**
   * Rate an asset
   */
  async rateAsset(assetId: string, rating: number): Promise<boolean> {
    if (rating < 1 || rating > 5) {
      console.error('Rating must be between 1 and 5');
      return false;
    }

    try {
      // In a real implementation, this would send a request to rate the asset
      console.log(`Rating asset ${assetId} with ${rating} stars`);
      return true;
    } catch (error) {
      console.error(`Error rating asset with ID ${assetId}:`, error);
      return false;
    }
  }

  /**
   * Get user's uploaded assets
   */
  async getUserAssets(userId: string): Promise<MarketplaceAsset[]> {
    try {
      // In a real implementation, this would fetch user's assets from API
      console.log(`Fetching assets for user: ${userId}`);
      return [];
    } catch (error) {
      console.error(`Error fetching user assets for ${userId}:`, error);
      return [];
    }
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.cachedAssets.clear();
    this.cachedCategories = [];
    this.searchCache.clear();
  }

  /**
   * Get trending assets
   */
  async getTrendingAssets(): Promise<MarketplaceAsset[]> {
    try {
      // Mock trending assets
      const trendingAssets: MarketplaceAsset[] = [
        {
          id: 'trend-1',
          name: 'Summer Sale Flyer',
          description: 'Eye-catching summer sale flyer template',
          tags: ['sale', 'summer', 'flyer', 'promotion'],
          category: 'templates',
          author: 'SaleDesigns',
          rating: 4.6,
          downloads: 12500,
          thumbnailUrl: 'https://example.com/thumbnails/summer-sale.jpg',
          fileUrl: 'https://example.com/templates/summer-sale.apocatemplate',
          fileType: 'template',
          license: 'premium',
          createdAt: new Date('2023-05-20'),
          updatedAt: new Date('2023-05-20'),
          fileSize: 3584000,
          isVerified: true
        }
      ];

      return trendingAssets;
    } catch (error) {
      console.error('Error fetching trending assets:', error);
      return [];
    }
  }
}

// Create a singleton instance
export const templateMarketplace = TemplateMarketplace.getInstance();

// Helper function to convert marketplace template to editor template
export const convertMarketplaceTemplate = (asset: MarketplaceAsset): Template => {
  return {
    id: asset.id,
    name: asset.name,
    canvasData: '', // Would be populated when downloaded
    defaultThemeId: '',
    thumbnail: asset.thumbnailUrl,
    canvasSize: { width: 800, height: 600 }, // Default size, would be overridden when loaded
    unitMode: 'px'
  };
};