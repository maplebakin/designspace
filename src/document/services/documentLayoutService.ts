import { normalizeDesignSpaceProjectPayload, type DocumentProjectPayload } from '../../editor/project/projectSchema';
import { assertIndexedDbStartupAllowed } from '../../editor/persistence/startupStorageRecovery';
import { findMissingDocumentAssetIds, pruneDocumentAssets } from '../model/documentAssets';

export type DocumentLayoutRecord = {
  id?: number;
  name: string;
  updatedAt: string;
  payload: DocumentProjectPayload;
};

const layoutDb = async () => {
  assertIndexedDbStartupAllowed();
  return (await import('../../editor/db')).db;
};

export const createDocumentLayout = (project: DocumentProjectPayload, pageIndex: number, name: string): DocumentLayoutRecord => {
  const page = project.pages[pageIndex];
  if (!page) throw new Error('Choose a page to save as a layout.');
  const pages = [{ ...page, reference: undefined }];
  if (findMissingDocumentAssetIds(pages, project.assets).length > 0) throw new Error('Replace missing images before saving this layout.');
  const compact = pruneDocumentAssets(pages, project.assets, project.assetMetadata);
  for (const source of Object.values(compact.assets)) {
    if (!source.startsWith('data:')) throw new Error('Layouts require imported, embedded images. Import this image before saving the layout.');
  }
  return {
    name: name.trim() || page.name,
    updatedAt: new Date().toISOString(),
    payload: normalizeDesignSpaceProjectPayload<DocumentProjectPayload['pages'][number]>({
      ...project, pages, activePageIndex: 0, ...compact,
    }, { editorMode: 'document' }) as DocumentProjectPayload,
  };
};

export const saveDocumentLayout = async (record: DocumentLayoutRecord) => (await layoutDb()).documentLayouts.add(record);
export const listDocumentLayouts = async () => (await layoutDb()).documentLayouts.orderBy('updatedAt').reverse().toArray();
export const deleteDocumentLayout = async (id: number) => (await layoutDb()).documentLayouts.delete(id);
