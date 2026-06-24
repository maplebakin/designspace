import JSZip from 'jszip';
import type {
  ProductForgeArtifact,
  ProductForgeArtifactResult,
} from './generateProductForgeArtifacts';
import type {
  ProjectExportSettings,
  ProjectProductMetadata,
  ProjectRecipe,
  ProjectTheme,
} from '../project/projectSchema';

export type ProductForgePackagedFile = {
  path: string;
  kind: string;
  mimeType: string;
  sizeBytes?: number;
  status: 'packaged' | 'skipped' | 'failed';
  error?: string;
};

export type ProductForgeZipPackageResult = {
  status: 'generated' | 'failed';
  fileName: string;
  mimeType: 'application/zip';
  blob?: Blob;
  sizeBytes?: number;
  manifest: ProductForgeArtifactResult['manifest'];
  packagedFiles: ProductForgePackagedFile[];
  errors?: string[];
};

export type PackageProductForgeZipOptions = {
  productMetadata?: ProjectProductMetadata;
  recipe?: ProjectRecipe;
  theme?: ProjectTheme;
  exportSettings?: ProjectExportSettings;
  fileName?: string;
};

const ZIP_MIME_TYPE = 'application/zip' as const;
const TEXT_MIME_TYPE = 'text/markdown';
const JSON_MIME_TYPE = 'application/json';

const stripExtension = (fileName: string) =>
  fileName.replace(/\.[a-z0-9]+$/i, '');

const slugify = (value: string) => {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'design-space-product';
};

const sanitizePathPart = (value: string) => {
  const parts = value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  const safe = parts[parts.length - 1]
    ?.replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'file';
};

const getArtifactError = (artifact: ProductForgeArtifact | undefined, label: string) => {
  if (!artifact) return `${label} artifact is missing.`;
  if (artifact.status !== 'generated') {
    return `${label} artifact is ${artifact.status}${artifact.error ? `: ${artifact.error}` : '.'}`;
  }
  if (!artifact.blob) return `${label} artifact did not include a blob.`;
  return null;
};

const makeJsonBlob = (value: unknown) =>
  new Blob([JSON.stringify(value, null, 2)], { type: JSON_MIME_TYPE });

const makeMarkdownBlob = (value: string) =>
  new Blob([value], { type: TEXT_MIME_TYPE });

const bulletList = (items: string[]) =>
  items.length > 0
    ? items.map((item) => `- ${item}`).join('\n')
    : '- Printable PDF\n- PNG preview images\n- Metadata JSON';

const buildReadme = (
  artifactResult: ProductForgeArtifactResult,
  options: PackageProductForgeZipOptions
) => {
  const metadata = options.productMetadata;
  const description = metadata?.description || `Printable digital planner: ${artifactResult.productTitle}.`;
  const includedFiles = metadata?.includedFiles?.length
    ? metadata.includedFiles
    : artifactResult.manifest.files.map((file) => file.fileName);
  const pageSize = artifactResult.manifest.pageSize;
  const recipeLine = artifactResult.recipeId
    ? `Recipe: ${artifactResult.recipeId}${artifactResult.recipeVersion ? ` v${artifactResult.recipeVersion}` : ''}`
    : 'Recipe: Design Space generated product';
  const themeLine = options.theme?.name || artifactResult.themeName
    ? `Theme: ${options.theme?.name || artifactResult.themeName}`
    : undefined;

  return [
    `# ${artifactResult.productTitle}`,
    '',
    description,
    '',
    '## Included Files',
    '',
    bulletList(includedFiles),
    '',
    '## Print / Use Notes',
    '',
    `- Page count: ${artifactResult.pageCount}`,
    `- Page size: ${pageSize.width} x ${pageSize.height}${pageSize.unitMode ? ` ${pageSize.unitMode}` : ''}${pageSize.dpi ? ` @ ${pageSize.dpi} DPI` : ''}`,
    '- For best results, print at actual size / 100% scale unless your printer requires fit-to-page.',
    '- This is a digital download. No physical item is shipped.',
    '',
    '## Product Metadata',
    '',
    `- ${recipeLine}`,
    ...(themeLine ? [`- ${themeLine}`] : []),
    ...(options.exportSettings?.pdfFileName ? [`- Printable PDF: ${options.exportSettings.pdfFileName}`] : []),
    '',
    '## License / Usage',
    '',
    'Personal/commercial use terms are not configured yet. Replace this placeholder with the final license before marketplace publishing.',
    '',
  ].join('\n');
};

const buildListingCopy = (
  artifactResult: ProductForgeArtifactResult,
  options: PackageProductForgeZipOptions
) => {
  const metadata = options.productMetadata;
  const listing = metadata?.listingCopy;
  const title = metadata?.title || artifactResult.productTitle;
  const shortDescription = listing?.shortDescription || metadata?.description || `Printable digital planner: ${title}.`;
  const bullets = listing?.bullets?.length
    ? listing.bullets
    : [
        `${artifactResult.pageCount}-page printable planner`,
        'Includes printable PDF and PNG preview images',
        'Designed as a digital download',
      ];
  const includedFiles = metadata?.includedFiles?.length
    ? metadata.includedFiles
    : artifactResult.manifest.files.map((file) => file.fileName);
  const tags = metadata?.tags?.length
    ? metadata.tags
    : [
        artifactResult.recipeId,
        artifactResult.themeName,
        'printable planner',
      ].filter((value): value is string => Boolean(value));

  return [
    `# ${title}`,
    '',
    '## Short Description',
    '',
    shortDescription,
    '',
    '## Bullet List',
    '',
    bulletList(bullets),
    '',
    '## Included Files',
    '',
    bulletList(includedFiles),
    '',
    '## Suggested Tags',
    '',
    tags.join(', '),
    '',
    '## Digital Download Note',
    '',
    'Digital download only. No physical item will be shipped.',
    '',
  ].join('\n');
};

const addPackagedBlob = (
  zip: JSZip,
  rootFolder: string,
  path: string,
  kind: string,
  mimeType: string,
  blob: Blob,
  packagedFiles: ProductForgePackagedFile[]
) => {
  const fullPath = `${rootFolder}/${path}`;
  zip.file(fullPath, blob);
  packagedFiles.push({
    path: fullPath,
    kind,
    mimeType,
    sizeBytes: blob.size,
    status: 'packaged',
  });
};

export const packageProductForgeZip = async (
  artifactResult: ProductForgeArtifactResult,
  options: PackageProductForgeZipOptions = {}
): Promise<ProductForgeZipPackageResult> => {
  const slug = slugify(options.productMetadata?.title || artifactResult.productTitle);
  const fileName = options.fileName
    || `${stripExtension(options.exportSettings?.pdfFileName || slug)}-product-forge.zip`;
  const rootFolder = stripExtension(fileName).replace(/-product-forge$/i, '') || slug;
  const artifacts = artifactResult.artifacts;
  const pdfArtifact = artifacts.find((artifact) => artifact.kind === 'printable-pdf');
  const metadataArtifact = artifacts.find((artifact) => artifact.kind === 'metadata-json');
  const errors = [
    getArtifactError(pdfArtifact, 'Printable PDF'),
    getArtifactError(metadataArtifact, 'Metadata JSON'),
  ].filter((error): error is string => Boolean(error));
  const packagedFiles: ProductForgePackagedFile[] = [];

  artifacts
    .filter((artifact) => artifact.kind === 'preview-png' && artifact.status !== 'generated')
    .forEach((artifact) => {
      packagedFiles.push({
        path: `${rootFolder}/previews/${sanitizePathPart(artifact.fileName)}`,
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        status: artifact.status === 'failed' ? 'failed' : 'skipped',
        error: artifact.error,
      });
    });

  if (errors.length > 0) {
    return {
      status: 'failed',
      fileName,
      mimeType: ZIP_MIME_TYPE,
      manifest: artifactResult.manifest,
      packagedFiles,
      errors,
    };
  }

  const zip = new JSZip();

  addPackagedBlob(
    zip,
    rootFolder,
    sanitizePathPart(pdfArtifact!.fileName),
    pdfArtifact!.kind,
    pdfArtifact!.mimeType,
    pdfArtifact!.blob!,
    packagedFiles
  );

  artifacts
    .filter((artifact) => artifact.kind === 'preview-png' && artifact.status === 'generated' && artifact.blob)
    .forEach((artifact) => {
      addPackagedBlob(
        zip,
        rootFolder,
        `previews/${sanitizePathPart(artifact.fileName)}`,
        artifact.kind,
        artifact.mimeType,
        artifact.blob!,
        packagedFiles
      );
    });

  addPackagedBlob(
    zip,
    rootFolder,
    'metadata.json',
    metadataArtifact!.kind,
    metadataArtifact!.mimeType,
    metadataArtifact!.blob!,
    packagedFiles
  );

  const manifestBlob = makeJsonBlob(artifactResult.manifest);
  addPackagedBlob(
    zip,
    rootFolder,
    'manifest.json',
    'manifest-json',
    JSON_MIME_TYPE,
    manifestBlob,
    packagedFiles
  );

  const readmeBlob = makeMarkdownBlob(buildReadme(artifactResult, options));
  addPackagedBlob(
    zip,
    rootFolder,
    'README.md',
    'readme',
    TEXT_MIME_TYPE,
    readmeBlob,
    packagedFiles
  );

  const listingBlob = makeMarkdownBlob(buildListingCopy(artifactResult, options));
  addPackagedBlob(
    zip,
    rootFolder,
    'listing-copy.md',
    'listing-copy',
    TEXT_MIME_TYPE,
    listingBlob,
    packagedFiles
  );

  const blob = await zip.generateAsync({ type: 'blob', mimeType: ZIP_MIME_TYPE });

  return {
    status: 'generated',
    fileName,
    mimeType: ZIP_MIME_TYPE,
    blob,
    sizeBytes: blob.size,
    manifest: artifactResult.manifest,
    packagedFiles,
    errors: packagedFiles
      .filter((file) => file.status === 'failed')
      .map((file) => `${file.path}: ${file.error || 'failed'}`),
  };
};
