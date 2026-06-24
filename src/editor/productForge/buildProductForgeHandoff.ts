import type { ProductAwareProjectPayload, ProjectExportFormat } from '../project/projectSchema';

export type ProductForgeIncludedFile = {
  kind: 'pdf' | 'png-preview' | 'readme' | 'listing-copy' | 'metadata-json';
  label: string;
  fileName: string;
  format: ProjectExportFormat | 'md' | 'json';
  status: 'metadata-only';
};

export type ProductForgeHandoffMetadata = {
  schemaVersion: 'product-forge-handoff-v1';
  sourceApp: 'design-space';
  projectId: string;
  projectTitle: string;
  productTitle: string;
  recipe?: {
    id?: string;
    version?: string;
  };
  theme?: {
    themeId?: string;
    name?: string;
    source?: string;
    version?: string;
  };
  pageSize: {
    presetId?: string;
    width: number;
    height: number;
    unitMode: string;
    dpi: number;
  };
  pageCount: number;
  exportFiles: {
    pdfFileName?: string;
    previewFileNames: string[];
    formats: string[];
    dpi?: number;
    includeBackground?: boolean;
  };
  product: {
    description?: string;
    tags: string[];
    category?: string;
    useCases: string[];
  };
  includedFilesManifest: ProductForgeIncludedFile[];
  blobGeneration: {
    status: 'not-generated';
    nextStep: string;
  };
};

const stripExtension = (fileName: string) =>
  fileName.replace(/\.[a-z0-9]+$/i, '');

const fallbackSlug = (project: ProductAwareProjectPayload<any>) =>
  project.metadata.slug
  || stripExtension(project.exportSettings?.pdfFileName ?? '')
  || project.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  || 'design-space-product';

const buildIncludedFilesManifest = (
  project: ProductAwareProjectPayload<any>
): ProductForgeIncludedFile[] => {
  const slug = fallbackSlug(project);
  const pdfFileName = project.exportSettings?.pdfFileName ?? `${slug}.pdf`;
  const previewFileNames = project.exportSettings?.previewFileNames?.length
    ? project.exportSettings.previewFileNames
    : [`${slug}-preview-page-01.png`];

  return [
    {
      kind: 'pdf',
      label: 'printable PDF',
      fileName: pdfFileName,
      format: 'pdf',
      status: 'metadata-only',
    },
    ...previewFileNames.map((fileName, index): ProductForgeIncludedFile => ({
      kind: 'png-preview',
      label: `PNG preview image ${index + 1}`,
      fileName,
      format: 'png',
      status: 'metadata-only',
    })),
    {
      kind: 'readme',
      label: 'README',
      fileName: `${slug}-README.md`,
      format: 'md',
      status: 'metadata-only',
    },
    {
      kind: 'listing-copy',
      label: 'listing copy',
      fileName: `${slug}-listing-copy.md`,
      format: 'md',
      status: 'metadata-only',
    },
    {
      kind: 'metadata-json',
      label: 'metadata JSON',
      fileName: `${slug}-metadata.json`,
      format: 'json',
      status: 'metadata-only',
    },
  ];
};

export const buildProductForgeHandoff = (
  project: ProductAwareProjectPayload<any>
): ProductForgeHandoffMetadata => ({
  schemaVersion: 'product-forge-handoff-v1',
  sourceApp: 'design-space',
  projectId: project.projectId,
  projectTitle: project.metadata.name || project.projectName,
  productTitle: project.productMetadata?.title || project.metadata.name || project.projectName,
  recipe: project.recipe
    ? {
        id: project.recipe.id,
        version: project.recipe.version,
      }
    : undefined,
  theme: project.theme
    ? {
        themeId: project.theme.themeId,
        name: project.theme.name,
        source: project.theme.source,
        version: project.theme.version,
      }
    : undefined,
  pageSize: project.document.pageSize,
  pageCount: project.pages.length,
  exportFiles: {
    pdfFileName: project.exportSettings?.pdfFileName,
    previewFileNames: project.exportSettings?.previewFileNames ?? [],
    formats: project.exportSettings?.formats ?? [],
    dpi: project.exportSettings?.dpi,
    includeBackground: project.exportSettings?.includeBackground,
  },
  product: {
    description: project.productMetadata?.description,
    tags: project.productMetadata?.tags ?? [],
    category: project.productMetadata?.category,
    useCases: project.productMetadata?.useCases ?? [],
  },
  includedFilesManifest: buildIncludedFilesManifest(project),
  blobGeneration: {
    status: 'not-generated',
    nextStep: 'Generate PDF and PNG blobs through AdvancedExportManager before Product Forge ZIP packaging.',
  },
});
