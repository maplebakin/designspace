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
import {
  buildProductForgeArchivePath,
  getProductForgePathCollisionKey,
  sanitizeProductForgeFileName,
  sanitizeProductForgeSlug,
} from './safeProductForgePaths';

export type ProductForgePackagedFile = {
  path: string;
  kind: string;
  mimeType: string;
  sizeBytes?: number;
  status: 'packaged' | 'skipped' | 'failed';
  error?: string;
};

export type ProductForgePackagedManifest = ProductForgeArtifactResult['manifest'] & {
  generatedArtifacts: ProductForgeArtifactResult['manifest']['files'];
  packagedFiles: ProductForgePackagedFile[];
};

export type ProductForgeZipPackageResult = {
  status: 'generated' | 'failed';
  fileName: string;
  mimeType: 'application/zip';
  blob?: Blob;
  sizeBytes?: number;
  manifest: ProductForgePackagedManifest;
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
const CUSTOMER_FILES_DIRECTORY = 'customer-files';
const SELLER_ASSETS_DIRECTORY = 'seller-assets';

const stripExtension = (fileName: string) =>
  fileName.replace(/\.[a-z0-9]+$/i, '');

const getArtifactError = (artifact: ProductForgeArtifact | undefined, label: string) => {
  if (!artifact) return `${label} artifact is missing.`;
  if (artifact.status !== 'generated') {
    return `${label} artifact is ${artifact.status}${artifact.error ? `: ${artifact.error}` : '.'}`;
  }
  if (!artifact.blob) return `${label} artifact did not include a blob.`;
  if (artifact.blob.size <= 0) return `${label} artifact is empty.`;
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

const hasEditableSourceFile = (files: ProductForgePackagedFile[]) =>
  files.some((file) => /\.(apocaproject|json)$/i.test(file.path) && file.kind === 'editable-project');

const sanitizeListingBullet = (item: string, includesEditableSource: boolean) => {
  if (includesEditableSource) return item;
  return item.replace(/^Editable\s+/i, '');
};

const formatPageSize = (artifactResult: ProductForgeArtifactResult) => {
  const pageSize = artifactResult.manifest.pageSize;
  const sourceDpi = artifactResult.manifest.rendering?.sourceDpi || pageSize.dpi;
  const widthInches = sourceDpi ? pageSize.width / sourceDpi : undefined;
  const heightInches = sourceDpi ? pageSize.height / sourceDpi : undefined;
  const isUsLetter = widthInches
    && heightInches
    && Math.abs(widthInches - 8.5) < 0.01
    && Math.abs(heightInches - 11) < 0.01;

  if (isUsLetter) {
    return 'US Letter, 8.5 x 11 in';
  }
  return widthInches && heightInches
    ? `${widthInches.toFixed(2)} x ${heightInches.toFixed(2)} in (${pageSize.width} x ${pageSize.height} px source)`
    : `${pageSize.width} x ${pageSize.height}${pageSize.unitMode ? ` ${pageSize.unitMode}` : ''}`;
};

const formatPreviewSize = (artifactResult: ProductForgeArtifactResult) => {
  const pageSize = artifactResult.manifest.pageSize;
  const sourceDpi = artifactResult.manifest.rendering?.sourceDpi || pageSize.dpi || 300;
  const previewDpi = artifactResult.manifest.rendering?.previewDpi || sourceDpi;
  const scale = previewDpi / sourceDpi;
  return `${Math.max(1, Math.round(pageSize.width * scale))} x ${Math.max(1, Math.round(pageSize.height * scale))} px at ${previewDpi} DPI`;
};

const buildPackagedManifest = (
  artifactResult: ProductForgeArtifactResult,
  packagedFiles: ProductForgePackagedFile[]
): ProductForgePackagedManifest => ({
  ...artifactResult.manifest,
  files: packagedFiles.map((file) => ({
    fileName: file.path,
    kind: file.kind,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  })),
  generatedArtifacts: artifactResult.manifest.files,
  packagedFiles,
});

const buildReadme = (
  artifactResult: ProductForgeArtifactResult,
  options: PackageProductForgeZipOptions,
  packagedFiles: ProductForgePackagedFile[]
) => {
  const metadata = options.productMetadata;
  const description = metadata?.description || `Printable digital planner: ${artifactResult.productTitle}.`;
  const includedFiles = packagedFiles
    .filter((file) => file.path.includes(`/${CUSTOMER_FILES_DIRECTORY}/`))
    .map((file) => file.path.split('/').pop() || file.path);
  const themeLine = options.theme?.name || artifactResult.themeName
    ? `Theme: ${options.theme?.name || artifactResult.themeName}`
    : undefined;
  const sourceDpi = artifactResult.manifest.rendering?.sourceDpi
    || artifactResult.manifest.pageSize.dpi;
  const pdfImageDpi = artifactResult.manifest.rendering?.pdfImageDpi;

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
    `- Page size: ${formatPageSize(artifactResult)}`,
    ...(sourceDpi ? [`- Source canvas density: ${sourceDpi} DPI`] : []),
    ...(pdfImageDpi ? [`- Printable PDF raster density: up to ${pdfImageDpi} DPI`] : []),
    `- Preview images: ${formatPreviewSize(artifactResult)}`,
    '- For best results, print at actual size / 100% scale unless your printer requires fit-to-page.',
    '- This is a digital download. No physical item is shipped.',
    '',
    '## Product Metadata',
    '',
    '- Product type: Printable worksheet kit',
    `- Format: PDF with PNG previews`,
    ...(themeLine ? [`- ${themeLine}`] : []),
    ...(options.exportSettings?.pdfFileName ? [`- Printable PDF: ${options.exportSettings.pdfFileName}`] : []),
    '',
  ].join('\n');
};

const buildSellerPreflight = (artifactResult: ProductForgeArtifactResult) => [
  `# Seller Preflight — ${artifactResult.productTitle}`,
  '',
  'This Product Forge ZIP is an internal production bundle, not a ready-to-upload customer ZIP.',
  '',
  '## Required before publishing',
  '',
  '- Review the printable PDF and every preview image.',
  '- Confirm fonts, graphics, templates, and other assets are licensed for the intended sale.',
  '- Add the owner-approved customer license or usage terms to `customer-files/`.',
  '- Build the customer download only from `customer-files/`; do not include `seller-assets/`.',
  '- Verify the listing copy, filenames, page size, and print-at-100% guidance.',
  '',
  'Design Space cannot infer or grant licensing rights.',
  '',
].join('\n');

const buildListingCopy = (
  artifactResult: ProductForgeArtifactResult,
  options: PackageProductForgeZipOptions,
  packagedFiles: ProductForgePackagedFile[]
) => {
  const metadata = options.productMetadata;
  const listing = metadata?.listingCopy;
  const title = metadata?.title || artifactResult.productTitle;
  const shortDescription = listing?.shortDescription || metadata?.description || `Printable digital planner: ${title}.`;
  const includesEditableSource = hasEditableSourceFile(packagedFiles);
  const bullets = listing?.bullets?.length
    ? listing.bullets.map((item) => sanitizeListingBullet(item, includesEditableSource))
    : [
        `${artifactResult.pageCount}-page printable planner`,
        'Includes printable PDF and PNG preview images',
        'Designed as a digital download',
      ];
  const includedFiles = metadata?.includedFiles?.length
    ? metadata.includedFiles
    : packagedFiles.map((file) => file.path);
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
  archivePath: string,
  kind: string,
  mimeType: string,
  blob: Blob,
  packagedFiles: ProductForgePackagedFile[]
) => {
  zip.file(archivePath, blob);
  packagedFiles.push({
    path: archivePath,
    kind,
    mimeType,
    sizeBytes: blob.size,
    status: 'packaged',
  });
};

const addPackageManifestFiles = (
  zip: JSZip,
  metadataPath: string,
  manifestPath: string,
  artifactResult: ProductForgeArtifactResult,
  packagedFiles: ProductForgePackagedFile[]
) => {
  let metadataBlob = makeJsonBlob({});
  let manifestBlob = makeJsonBlob({});
  let nextPackagedFiles = packagedFiles;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    nextPackagedFiles = [
      ...packagedFiles,
      {
        path: metadataPath,
        kind: 'metadata-json',
        mimeType: JSON_MIME_TYPE,
        sizeBytes: metadataBlob.size,
        status: 'packaged' as const,
      },
      {
        path: manifestPath,
        kind: 'manifest-json',
        mimeType: JSON_MIME_TYPE,
        sizeBytes: manifestBlob.size,
        status: 'packaged' as const,
      },
    ];
    const nextManifest = buildPackagedManifest(artifactResult, nextPackagedFiles);
    const nextMetadataBlob = makeJsonBlob(nextManifest);
    const nextManifestBlob = makeJsonBlob(nextManifest);
    const isStable = nextMetadataBlob.size === metadataBlob.size && nextManifestBlob.size === manifestBlob.size;
    metadataBlob = nextMetadataBlob;
    manifestBlob = nextManifestBlob;
    if (isStable) break;
  }

  packagedFiles.push(
    {
      path: metadataPath,
      kind: 'metadata-json',
      mimeType: JSON_MIME_TYPE,
      sizeBytes: metadataBlob.size,
      status: 'packaged',
    },
    {
      path: manifestPath,
      kind: 'manifest-json',
      mimeType: JSON_MIME_TYPE,
      sizeBytes: manifestBlob.size,
      status: 'packaged',
    }
  );
  zip.file(metadataPath, metadataBlob);
  zip.file(manifestPath, manifestBlob);
};

export const packageProductForgeZip = async (
  artifactResult: ProductForgeArtifactResult,
  options: PackageProductForgeZipOptions = {}
): Promise<ProductForgeZipPackageResult> => {
  const slug = sanitizeProductForgeSlug(
    options.productMetadata?.title || artifactResult.productTitle
  );
  const requestedFileName = options.fileName
    || `${stripExtension(options.exportSettings?.pdfFileName || slug)}-product-forge.zip`;
  const fileName = sanitizeProductForgeFileName(
    requestedFileName,
    '.zip',
    `${slug}-product-forge`
  );
  const rootFolder = sanitizeProductForgeSlug(
    stripExtension(fileName).replace(/-product-forge$/i, ''),
    slug
  );
  const artifacts = artifactResult.artifacts;
  const pdfArtifact = artifacts.find((artifact) => artifact.kind === 'printable-pdf');
  const metadataArtifact = artifacts.find((artifact) => artifact.kind === 'metadata-json');
  const previewArtifacts = artifacts.filter((artifact) => artifact.kind === 'preview-png');
  const pdfPath = buildProductForgeArchivePath(
    rootFolder,
    sanitizeProductForgeFileName(pdfArtifact?.fileName, '.pdf', slug),
    [CUSTOMER_FILES_DIRECTORY]
  );
  const previewEntries = previewArtifacts.map((artifact) => ({
    artifact,
    path: buildProductForgeArchivePath(
      rootFolder,
      sanitizeProductForgeFileName(
        artifact.fileName,
        '.png',
        `${slug}-preview-page-${String(artifact.pageNumber || 0).padStart(2, '0')}`
      ),
      [SELLER_ASSETS_DIRECTORY, 'previews']
    ),
  }));
  const readmePath = buildProductForgeArchivePath(
    rootFolder,
    'PRINT-INSTRUCTIONS.md',
    [CUSTOMER_FILES_DIRECTORY]
  );
  const preflightPath = buildProductForgeArchivePath(
    rootFolder,
    'SELLER-PREFLIGHT.md',
    [SELLER_ASSETS_DIRECTORY]
  );
  const listingPath = buildProductForgeArchivePath(
    rootFolder,
    'listing-copy.md',
    [SELLER_ASSETS_DIRECTORY]
  );
  const metadataPath = buildProductForgeArchivePath(
    rootFolder,
    'metadata.json',
    [SELLER_ASSETS_DIRECTORY]
  );
  const manifestPath = buildProductForgeArchivePath(
    rootFolder,
    'manifest.json',
    [SELLER_ASSETS_DIRECTORY]
  );
  const requiredPreviewErrors: string[] = [];

  if (artifactResult.pageCount <= 0) {
    requiredPreviewErrors.push('Product package requires at least one page and preview.');
  }
  if (previewArtifacts.length !== artifactResult.pageCount) {
    requiredPreviewErrors.push(
      `Expected ${artifactResult.pageCount} preview artifact(s), received ${previewArtifacts.length}.`
    );
  }
  for (let pageNumber = 1; pageNumber <= artifactResult.pageCount; pageNumber += 1) {
    const pagePreviews = previewArtifacts.filter((artifact) => artifact.pageNumber === pageNumber);
    if (pagePreviews.length !== 1) {
      requiredPreviewErrors.push(
        `Preview page ${pageNumber} must have exactly one artifact; received ${pagePreviews.length}.`
      );
      continue;
    }
    const previewError = getArtifactError(pagePreviews[0], `Preview page ${pageNumber}`);
    if (previewError) requiredPreviewErrors.push(previewError);
  }

  const collisionErrors: string[] = [];
  const archivePathKeys = new Map<string, string>();
  [
    pdfPath,
    ...previewEntries.map((entry) => entry.path),
    readmePath,
    preflightPath,
    listingPath,
    metadataPath,
    manifestPath,
  ].forEach((path) => {
    const key = getProductForgePathCollisionKey(path);
    const existing = archivePathKeys.get(key);
    if (existing) {
      collisionErrors.push(`Archive path collision: "${existing}" and "${path}".`);
      return;
    }
    archivePathKeys.set(key, path);
  });

  const errors = [
    getArtifactError(pdfArtifact, 'Printable PDF'),
    getArtifactError(metadataArtifact, 'Metadata JSON'),
    ...requiredPreviewErrors,
    ...collisionErrors,
  ].filter((error): error is string => Boolean(error));
  const packagedFiles: ProductForgePackagedFile[] = [];

  previewEntries
    .filter(({ artifact }) => getArtifactError(artifact, 'Preview') !== null)
    .forEach(({ artifact, path }) => {
      const artifactError = getArtifactError(artifact, `Preview page ${artifact.pageNumber || '?'}`);
      packagedFiles.push({
        path,
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        status: artifact.status === 'skipped' ? 'skipped' : 'failed',
        error: artifact.error || artifactError || undefined,
      });
    });

  if (errors.length > 0) {
    const manifest = buildPackagedManifest(artifactResult, packagedFiles);
    return {
      status: 'failed',
      fileName,
      mimeType: ZIP_MIME_TYPE,
      manifest,
      packagedFiles,
      errors,
    };
  }

  const zip = new JSZip();

  addPackagedBlob(
    zip,
    pdfPath,
    pdfArtifact!.kind,
    pdfArtifact!.mimeType,
    pdfArtifact!.blob!,
    packagedFiles
  );

  previewEntries
    .filter(({ artifact }) => artifact.status === 'generated' && artifact.blob && artifact.blob.size > 0)
    .forEach(({ artifact, path }) => {
      addPackagedBlob(
        zip,
        path,
        artifact.kind,
        artifact.mimeType,
        artifact.blob!,
        packagedFiles
      );
    });

  const readmeBlob = makeMarkdownBlob(buildReadme(artifactResult, options, packagedFiles));
  addPackagedBlob(
    zip,
    readmePath,
    'customer-instructions',
    TEXT_MIME_TYPE,
    readmeBlob,
    packagedFiles
  );

  const preflightBlob = makeMarkdownBlob(buildSellerPreflight(artifactResult));
  addPackagedBlob(
    zip,
    preflightPath,
    'seller-preflight',
    TEXT_MIME_TYPE,
    preflightBlob,
    packagedFiles
  );

  const listingBlob = makeMarkdownBlob(buildListingCopy(artifactResult, options, packagedFiles));
  addPackagedBlob(
    zip,
    listingPath,
    'listing-copy',
    TEXT_MIME_TYPE,
    listingBlob,
    packagedFiles
  );

  addPackageManifestFiles(
    zip,
    metadataPath,
    manifestPath,
    artifactResult,
    packagedFiles
  );

  const blob = await zip.generateAsync({ type: 'blob', mimeType: ZIP_MIME_TYPE });
  const manifest = buildPackagedManifest(artifactResult, packagedFiles);

  return {
    status: 'generated',
    fileName,
    mimeType: ZIP_MIME_TYPE,
    blob,
    sizeBytes: blob.size,
    manifest,
    packagedFiles,
    errors: [],
  };
};
