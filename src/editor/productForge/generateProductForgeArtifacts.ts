import {
  advancedExportManager,
  type ExportPagesPdfOptions,
  type ExportedPageBlob,
} from '../export/advancedExportManager';
import {
  normalizeDesignSpaceProjectPayload,
  type ExistingProjectPage,
  type ProductAwareProjectPayload,
} from '../project/projectSchema';
import type { ProjectPage } from '../state/editorStore';
import {
  sanitizeProductForgeFileName,
  sanitizeProductForgeSlug,
} from './safeProductForgePaths';

export type ProductForgeArtifactKind = 'printable-pdf' | 'preview-png' | 'metadata-json';
export type ProductForgeArtifactStatus = 'generated' | 'skipped' | 'failed';

export type ProductForgeArtifact = {
  id: string;
  kind: ProductForgeArtifactKind;
  fileName: string;
  mimeType: string;
  blob?: Blob;
  sizeBytes?: number;
  pageNumber?: number;
  status: ProductForgeArtifactStatus;
  error?: string;
};

export type ProductForgeArtifactManifest = {
  schemaVersion: string;
  generatedAt: string;
  productTitle: string;
  recipeId?: string;
  recipeVersion?: string;
  themeName?: string;
  pageCount: number;
  pageSize: {
    width: number;
    height: number;
    unitMode?: string;
    dpi?: number;
  };
  rendering: {
    sourceDpi: number;
    previewDpi: number;
    pdfImageDpi: number;
  };
  files: Array<{
    fileName: string;
    kind: string;
    mimeType: string;
    sizeBytes?: number;
    pageNumber?: number;
  }>;
};

export type ProductForgeArtifactResult = {
  productTitle: string;
  recipeId?: string;
  recipeVersion?: string;
  themeName?: string;
  pageCount: number;
  artifacts: ProductForgeArtifact[];
  manifest: ProductForgeArtifactManifest;
};

export type ProductForgeArtifactExportManager = {
  exportPagesPdfBlob: (pages: ProjectPage[], options?: ExportPagesPdfOptions) => Promise<Blob>;
  exportPagesToBlobs: (
    pages: ProjectPage[],
    format: 'png',
    options?: ExportPagesPdfOptions
  ) => Promise<ExportedPageBlob[]>;
};

export type GenerateProductForgeArtifactsOptions = {
  exportManager?: ProductForgeArtifactExportManager;
  imageAssets?: Record<string, string>;
  now?: string;
  previewPageLimit?: number;
  includePdf?: boolean;
  includePreviews?: boolean;
  includeMetadata?: boolean;
};

const GENERATED_SCHEMA_VERSION = 'product-forge-artifacts-v1';
const METADATA_MIME_TYPE = 'application/json';
const PDF_MIME_TYPE = 'application/pdf';
const PNG_MIME_TYPE = 'image/png';

const stripExtension = (fileName: string) =>
  fileName.replace(/\.[a-z0-9]+$/i, '');

const getErrorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : String(error || 'Unknown export error');

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeArtifactProjectPayload = (
  source: unknown,
  now: string
) => {
  if (!isRecord(source) || !isRecord(source.productProjectFields)) {
    return normalizeDesignSpaceProjectPayload<ExistingProjectPage>(source);
  }

  const pages = Array.isArray(source.pages) ? source.pages : [];
  const activePageIndex = typeof source.activePageIndex === 'number' ? source.activePageIndex : 0;
  const activePage = pages[Math.max(0, Math.min(activePageIndex, Math.max(0, pages.length - 1)))];
  return normalizeDesignSpaceProjectPayload<ExistingProjectPage>({
    ...source.productProjectFields,
    projectName: source.projectName,
    pages,
    activePageIndex,
    canvasData: activePage?.canvasData ?? source.canvasData,
    assets: isRecord(source.imageAssets) ? source.imageAssets : source.assets,
    activeTheme: source.activeTheme,
    lastUpdated: typeof source.lastUpdated === 'string' ? source.lastUpdated : now,
    canvasSize: source.canvasSize ?? activePage?.canvasSize,
    unitMode: source.unitMode,
  }, {
    now,
  });
};

const buildManifest = (
  project: ProductAwareProjectPayload<ExistingProjectPage>,
  generatedAt: string,
  productTitle: string,
  artifacts: ProductForgeArtifact[]
): ProductForgeArtifactManifest => ({
  schemaVersion: GENERATED_SCHEMA_VERSION,
  generatedAt,
  productTitle,
  recipeId: project.recipe?.id,
  recipeVersion: project.recipe?.version,
  themeName: project.theme?.name,
  pageCount: project.pages.length,
  pageSize: {
    width: project.document.pageSize.width,
    height: project.document.pageSize.height,
    unitMode: project.document.pageSize.unitMode,
    dpi: project.document.pageSize.dpi,
  },
  rendering: {
    sourceDpi: project.document.pageSize.dpi,
    previewDpi: project.exportSettings?.dpi ?? project.document.pageSize.dpi,
    pdfImageDpi: Math.min(
      200,
      project.exportSettings?.dpi ?? project.document.pageSize.dpi
    ),
  },
  files: artifacts.map((artifact) => ({
    fileName: artifact.fileName,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    pageNumber: artifact.pageNumber,
  })),
});

const makeJsonBlob = (value: unknown) =>
  new Blob([JSON.stringify(value, null, 2)], { type: METADATA_MIME_TYPE });

const buildMetadataArtifact = (
  project: ProductAwareProjectPayload<ExistingProjectPage>,
  generatedAt: string,
  productTitle: string,
  artifacts: ProductForgeArtifact[],
  metadataFileName: string
) => {
  let metadataArtifact: ProductForgeArtifact = {
    id: 'metadata-json',
    kind: 'metadata-json',
    fileName: metadataFileName,
    mimeType: METADATA_MIME_TYPE,
    status: 'generated',
  };
  let blob = makeJsonBlob(buildManifest(project, generatedAt, productTitle, [
    ...artifacts,
    metadataArtifact,
  ]));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    metadataArtifact = {
      ...metadataArtifact,
      sizeBytes: blob.size,
    };
    const manifest = buildManifest(project, generatedAt, productTitle, [
      ...artifacts,
      metadataArtifact,
    ]);
    const nextBlob = makeJsonBlob(manifest);
    if (nextBlob.size === blob.size) {
      blob = nextBlob;
      break;
    }
    blob = nextBlob;
  }

  return {
    ...metadataArtifact,
    blob,
    sizeBytes: blob.size,
  };
};

export const generateProductForgeArtifacts = async (
  projectPayload: unknown,
  options: GenerateProductForgeArtifactsOptions = {}
): Promise<ProductForgeArtifactResult> => {
  const generatedAt = options.now ?? new Date().toISOString();
  const project = normalizeArtifactProjectPayload(projectPayload, generatedAt);
  const exportManager = options.exportManager ?? advancedExportManager;
  const productTitle = project.productMetadata?.title || project.metadata.name || project.projectName;
  const slug = sanitizeProductForgeSlug(project.metadata.slug || productTitle);
  const pdfFileName = sanitizeProductForgeFileName(
    project.exportSettings?.pdfFileName,
    '.pdf',
    slug
  );
  const metadataFileName = 'metadata.json';
  const includePdf = options.includePdf ?? true;
  const includePreviews = options.includePreviews ?? true;
  const includeMetadata = options.includeMetadata ?? true;
  const previewFileNames = project.exportSettings?.previewFileNames?.length
    ? project.exportSettings.previewFileNames
    : project.pages.map((_, index) => `${slug}-preview-page-${String(index + 1).padStart(2, '0')}.png`);
  const previewLimit = Math.min(
    project.pages.length,
    Math.max(0, options.previewPageLimit ?? project.pages.length)
  );
  const exportOptions: ExportPagesPdfOptions = {
    includeBackground: project.exportSettings?.includeBackground ?? true,
    backgroundColor: project.document.background?.value,
    dpi: project.exportSettings?.dpi ?? project.document.pageSize.dpi,
    sourceDpi: project.document.pageSize.dpi,
    fileName: stripExtension(pdfFileName),
    imageAssets: options.imageAssets ?? project.assets ?? {},
  };
  const artifacts: ProductForgeArtifact[] = [];

  if (includePdf) {
    try {
      const blob = await exportManager.exportPagesPdfBlob(project.pages as ProjectPage[], exportOptions);
      if (!blob || blob.size <= 0) {
        throw new Error('Printable PDF export produced an empty blob.');
      }
      artifacts.push({
        id: 'printable-pdf',
        kind: 'printable-pdf',
        fileName: pdfFileName,
        mimeType: PDF_MIME_TYPE,
        blob,
        sizeBytes: blob.size,
        status: 'generated',
      });
    } catch (error) {
      artifacts.push({
        id: 'printable-pdf',
        kind: 'printable-pdf',
        fileName: pdfFileName,
        mimeType: PDF_MIME_TYPE,
        status: 'failed',
        error: getErrorMessage(error),
      });
    }
  } else {
    artifacts.push({
      id: 'printable-pdf',
      kind: 'printable-pdf',
      fileName: pdfFileName,
      mimeType: PDF_MIME_TYPE,
      status: 'skipped',
    });
  }

  for (let index = 0; index < project.pages.length; index += 1) {
    const pageNumber = index + 1;
    const fileName = sanitizeProductForgeFileName(
      previewFileNames[index],
      '.png',
      `${slug}-preview-page-${String(pageNumber).padStart(2, '0')}`
    );
    const id = `preview-png-page-${String(pageNumber).padStart(2, '0')}`;

    if (!includePreviews || index >= previewLimit) {
      artifacts.push({
        id,
        kind: 'preview-png',
        fileName,
        mimeType: PNG_MIME_TYPE,
        pageNumber,
        status: 'skipped',
      });
      continue;
    }

    try {
      const [exportedPage] = await exportManager.exportPagesToBlobs(
        [project.pages[index] as ProjectPage],
        'png',
        {
          ...exportOptions,
          fileName: stripExtension(fileName),
        }
      );
      const blob = exportedPage?.blob;
      if (!blob || blob.size <= 0) {
        throw new Error(`Preview page ${pageNumber} did not produce a PNG blob.`);
      }
      artifacts.push({
        id,
        kind: 'preview-png',
        fileName,
        mimeType: PNG_MIME_TYPE,
        blob,
        sizeBytes: blob.size,
        pageNumber,
        status: 'generated',
      });
    } catch (error) {
      artifacts.push({
        id,
        kind: 'preview-png',
        fileName,
        mimeType: PNG_MIME_TYPE,
        pageNumber,
        status: 'failed',
        error: getErrorMessage(error),
      });
    }
  }

  if (!includeMetadata) {
    artifacts.push({
      id: 'metadata-json',
      kind: 'metadata-json',
      fileName: metadataFileName,
      mimeType: METADATA_MIME_TYPE,
      status: 'skipped',
    });
  }

  let manifest = buildManifest(project, generatedAt, productTitle, artifacts);
  if (includeMetadata) {
    artifacts.push(buildMetadataArtifact(project, generatedAt, productTitle, artifacts, metadataFileName));
    manifest = buildManifest(project, generatedAt, productTitle, artifacts);
  }

  return {
    productTitle,
    recipeId: project.recipe?.id,
    recipeVersion: project.recipe?.version,
    themeName: project.theme?.name,
    pageCount: project.pages.length,
    artifacts,
    manifest,
  };
};
