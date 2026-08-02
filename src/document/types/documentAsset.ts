/** Metadata stored alongside the portable asset source map. */
export type DocumentAssetMetadata = {
  contentHash: string;
  byteLength: number;
  mimeType?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  fileName?: string;
};
