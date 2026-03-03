import { appConfig } from '../../config';

export type MarketplaceTemplate = {
  id: string;
  name: string;
  category: string;
  previewUrl: string;
  priceCents: number;
};

export const templateMarketplaceApi = {
  endpoint: `${appConfig.templateMarketplaceApiUrl}/templates`,
};
