import Dexie, { Table } from 'dexie';
import type { EditorMode } from './project/projectSchema';
import { assertIndexedDbStartupAllowed } from './persistence/startupStorageRecovery';

export const MAX_LIBRARY_PROJECT_CHARS = 100 * 1024 * 1024;
export const MAX_LIBRARY_THUMBNAIL_CHARS = 2 * 1024 * 1024;
export const MAX_DASHBOARD_PROJECTS = 100;

/**
 * Deterministic test-only barriers for the real IndexedDB write boundary.
 *
 * The barrier is intentionally process-local and has no effect unless a test
 * installs it. `Dexie.waitFor` keeps the read/write transaction alive while a
 * browser probe inspects the live session or performs history replay; the
 * transaction is still committed by the production Dexie code after release.
 */
export type DurableWriteBoundary =
  | 'create-project'
  | 'update-project'
  | 'rename-project';

type DurableWriteBarrier = (
  boundary: DurableWriteBoundary,
) => Promise<void> | void;

let durableWriteBarrierForTests: DurableWriteBarrier | null = null;

export const setDurableWriteBarrierForTests = (
  barrier: DurableWriteBarrier | null,
) => {
  durableWriteBarrierForTests = barrier;
};

const waitForDurableWriteBoundary = async (boundary: DurableWriteBoundary) => {
  const barrier = durableWriteBarrierForTests;
  if (!barrier) return;
  await Dexie.waitFor(Promise.resolve(barrier(boundary)));
};

const normalizeProjectRevision = (value: unknown): number => {
  const revision = Number(value);
  return Number.isFinite(revision) && revision >= 1
    ? Math.max(1, Math.trunc(revision))
    : 1;
};

export const fingerprintProjectPayload = (value: string) => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${value.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
};

/**
 * Fingerprint authored project content without volatile save timestamps. A
 * regenerated thumbnail or another save acknowledgement must not turn the
 * same authored scene into a new durable-content identity.
 */
export const fingerprintProjectContent = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fingerprintProjectPayload(value);
    }
    const stable = { ...(parsed as Record<string, unknown>) };
    delete stable.updatedAt;
    delete stable.lastUpdated;
    // Page thumbnails are derived previews, not authored scene content. They
    // are regenerated during synchronization and can legitimately differ
    // while the durable scene remains identical. Keep them out of the
    // content identity so a preview refresh does not force another giant
    // canvas-data rewrite.
    const stripPageThumbnails = (pages: unknown): unknown => {
      if (!Array.isArray(pages)) return pages;
      return pages.map((page) => {
        if (!page || typeof page !== 'object' || Array.isArray(page)) return page;
        const nextPage = { ...(page as Record<string, unknown>) };
        delete nextPage.thumbnail;
        if (Array.isArray(nextPage.pages)) {
          nextPage.pages = stripPageThumbnails(nextPage.pages);
        }
        return nextPage;
      });
    };
    if (Array.isArray(stable.pages)) {
      stable.pages = stripPageThumbnails(stable.pages);
    }
    return fingerprintProjectPayload(JSON.stringify(stable));
  } catch {
    return fingerprintProjectPayload(value);
  }
};

export interface Project {
  id?: string;
  name: string;
  lastModified: Date;
  thumbnail?: string; // Base64 encoded thumbnail
  canvasDataId: string; // Reference to canvasData entry
  // This is intentionally not indexed. Existing rows omit it and normalize to
  // canvas, so adding document routing metadata needs no IndexedDB migration.
  editorMode?: EditorMode;
  contentHash?: string;
  payloadLength?: number;
  /** Monotonic durable revision used by cross-context compare-and-swap writes. */
  revision?: number;
  quarantinedAt?: string;
  quarantineReason?: string;
}

export interface CanvasData {
  id: string;
  jsonPayload: string; // JSON string of canvas data
  projectId: string; // Reference to project
  lastModified?: Date; // Optional last modified date
  contentHash?: string;
  payloadLength?: number;
  /** Mirrors the owning project revision for forensic inspection/recovery. */
  revision?: number;
}

export type ProjectWriteResult =
  | {
      status: 'saved';
      projectId: string;
      revision: number;
    }
  | {
      status: 'conflict';
      projectId: string;
      expectedRevision: number;
      actualRevision: number;
    };

/** A stale browser/tab/session attempted to replace a newer durable project. */
export class ProjectRevisionConflictError extends Error {
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(projectId: string, expectedRevision: number, actualRevision: number) {
    super(
      `Project ${projectId} changed in another context (expected revision ${expectedRevision}, found ${actualRevision}).`
    );
    this.name = 'ProjectRevisionConflictError';
    this.projectId = projectId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export interface ProjectRecoveryRecord {
  projectId: string;
  quarantinedAt: string;
  reason: string;
}

export interface ProjectStorageDiagnostics {
  projectId: string;
  referencedCanvasDataId: string | null;
  canvasDataRowCount: number;
  duplicateCanvasDataIds: string[];
  referencedPayloadLength: number;
}

export interface BrandKit {
  id?: string;
  colors: string[]; // Array of hex codes
  typography: {
    heading: {
      fontFamily: string;
      fontSize: number;
      fontWeight: string;
    };
    body: {
      fontFamily: string;
      fontSize: number;
      fontWeight: string;
    };
  };
  logoAssets: string[]; // Array of asset IDs
}

export interface TemplateRecord {
  id?: number;
  name: string;
  thumbnail?: string;
  canvasData: object;
  canvasSize: { width: number; height: number };
  unitMode?: string;
  defaultThemeId?: string;
  category?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export class DesignSpaceDB extends Dexie {
  projects!: Table<Project>;
  canvasData!: Table<CanvasData>;
  brandKit!: Table<BrandKit>;
  templates!: Table<TemplateRecord, number>;
  projectRecovery!: Table<ProjectRecoveryRecord, string>;

  constructor() {
    super('DesignSpaceDB');
    this.version(4).stores({
      projects: '++id, name, lastModified, thumbnail, canvasDataId',
      canvasData: 'id, jsonPayload, projectId, lastModified',
      brandKit: '++id, colors, typography, logoAssets',
      templates: '++id, name, updatedAt, category',
    });
    this.version(5).stores({
      projects: '++id, name, lastModified, thumbnail, canvasDataId',
      canvasData: 'id, jsonPayload, projectId, lastModified',
      brandKit: '++id, colors, typography, logoAssets',
      templates: '++id, name, updatedAt, category',
      projectRecovery: 'projectId, quarantinedAt',
    });
    // Version 6 deliberately removes indexes over the potentially enormous
    // thumbnail/jsonPayload values. The values remain durable fields for
    // compatibility, but IndexedDB no longer duplicates them in index
    // storage. No row rewrite is performed so migration is recoverable and
    // existing forensic duplicate rows remain untouched.
    this.version(6).stores({
      projects: '++id, name, lastModified, canvasDataId, editorMode, contentHash',
      canvasData: 'id, projectId, lastModified, contentHash',
      brandKit: '++id, colors, typography, logoAssets',
      templates: '++id, name, updatedAt, category',
      projectRecovery: 'projectId, quarantinedAt',
    });
    // Revision fields are ordinary values rather than indexes. Keeping this
    // schema version explicit makes the durable conflict contract visible to
    // recovery tooling without re-indexing or rewriting any large payload.
    this.version(7).stores({
      projects: '++id, name, lastModified, canvasDataId, editorMode, contentHash',
      canvasData: 'id, projectId, lastModified, contentHash',
      brandKit: '++id, colors, typography, logoAssets',
      templates: '++id, name, updatedAt, category',
      projectRecovery: 'projectId, quarantinedAt',
    });

    // Create indexes
    this.projects = this.table('projects');
    this.canvasData = this.table('canvasData');
    this.brandKit = this.table('brandKit');
    this.templates = this.table('templates');
    this.projectRecovery = this.table('projectRecovery');
  }

  private projectListRequest: Promise<Project[]> | null = null;

  private validateProjectPayload(jsonPayload: string) {
    if (jsonPayload.length > MAX_LIBRARY_PROJECT_CHARS) {
      throw new Error('Project exceeds the 100 MB browser-library limit. Download it as a project file instead.');
    }
  }

  private normalizeThumbnail(thumbnail?: string) {
    return typeof thumbnail === 'string' && thumbnail.length <= MAX_LIBRARY_THUMBNAIL_CHARS
      ? thumbnail
      : undefined;
  }

  async saveProject(
    name: string,
    jsonPayload: string,
    thumbnail?: string,
    editorMode: EditorMode = 'canvas'
  ): Promise<string> {
    const result = await this.saveProjectWithRevision(name, jsonPayload, thumbnail, editorMode);
    return result.projectId;
  }

  /**
   * Allocate a new durable project and return its initial revision. The
   * regular saveProject wrapper remains string-returning for old callers.
   */
  async saveProjectWithRevision(
    name: string,
    jsonPayload: string,
    thumbnail?: string,
    editorMode: EditorMode = 'canvas'
  ): Promise<{ projectId: string; revision: number }> {
    assertIndexedDbStartupAllowed();
    this.validateProjectPayload(jsonPayload);
    const projectId = crypto.randomUUID();
    const canvasDataId = crypto.randomUUID();
    const contentHash = fingerprintProjectContent(jsonPayload);
    const revision = 1;
    
    // Create transaction to ensure both records are saved together
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      // Save canvas data
      await this.canvasData.add({
        id: canvasDataId,
        jsonPayload,
        projectId,
        contentHash,
        payloadLength: jsonPayload.length,
        revision,
      });
      
      // Save project
      await this.projects.add({
        id: projectId,
        name,
        lastModified: new Date(),
        thumbnail: this.normalizeThumbnail(thumbnail),
        canvasDataId,
        editorMode,
        contentHash,
        payloadLength: jsonPayload.length,
        revision,
      });

      // This remains inside the real Dexie transaction.  Tests may hold the
      // commit here to prove session/revision fencing without replacing the
      // persistence implementation with a fake table.
      await waitForDurableWriteBoundary('create-project');
      
      return { projectId, revision };
    });
  }

  async updateProject(
    projectId: string,
    name: string,
    jsonPayload: string,
    thumbnail?: string,
    editorMode?: EditorMode
  ): Promise<boolean> {
    assertIndexedDbStartupAllowed();
    this.validateProjectPayload(jsonPayload);
    const contentHash = fingerprintProjectContent(jsonPayload);
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project) throw new Error('Project not found');
      const currentRevision = normalizeProjectRevision(project.revision);
      const payloadChanged = project.contentHash !== contentHash
        || project.payloadLength !== jsonPayload.length;
      const referenced = await this.canvasData.get(project.canvasDataId);
      if (!referenced || referenced.projectId !== projectId) {
        throw new Error('Project canvas data reference is missing or inconsistent.');
      }
      if (payloadChanged) {
        // A legacy database may contain superseded rows with the same
        // projectId. Update only the row explicitly referenced by the project
        // record; rewriting the whole index was the source of unbounded
        // persistence growth during recovery.
        await this.canvasData.update(project.canvasDataId, {
          jsonPayload,
          contentHash,
          payloadLength: jsonPayload.length,
          lastModified: new Date(),
          revision: currentRevision + 1,
        });
      } else {
        // Metadata-only saves still advance the durable identity. Mirror that
        // revision on the referenced row without rewriting the large payload.
        await this.canvasData.update(project.canvasDataId, {
          lastModified: new Date(),
          revision: currentRevision + 1,
        });
      }
      
      // Update project
      await this.projects.update(projectId, {
        name,
        lastModified: new Date(),
        thumbnail: this.normalizeThumbnail(thumbnail),
        contentHash,
        payloadLength: jsonPayload.length,
        revision: currentRevision + 1,
        ...(editorMode ? { editorMode } : {}),
      });
      await waitForDurableWriteBoundary('update-project');
      return payloadChanged;
    });
  }

  /**
   * Replace a project only when the caller still owns the revision it loaded.
   * The check and both-row update occur in one IndexedDB transaction, so two
   * browser contexts cannot silently last-write-wins the same project.
   */
  async updateProjectIfRevision(
    projectId: string,
    name: string,
    jsonPayload: string,
    thumbnail: string | undefined,
    editorMode: EditorMode | undefined,
    expectedRevision: number,
  ): Promise<ProjectWriteResult> {
    assertIndexedDbStartupAllowed();
    this.validateProjectPayload(jsonPayload);
    if (!Number.isFinite(expectedRevision) || expectedRevision < 1) {
      throw new Error('A valid durable project revision is required for compare-and-swap writes.');
    }
    const contentHash = fingerprintProjectContent(jsonPayload);
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project) throw new Error('Project not found');
      const actualRevision = normalizeProjectRevision(project.revision);
      if (actualRevision !== Math.trunc(expectedRevision)) {
        return {
          status: 'conflict' as const,
          projectId,
          expectedRevision: Math.trunc(expectedRevision),
          actualRevision,
        };
      }

      const nextRevision = actualRevision + 1;
      const payloadChanged = project.contentHash !== contentHash
        || project.payloadLength !== jsonPayload.length;
      const referenced = await this.canvasData.get(project.canvasDataId);
      if (!referenced || referenced.projectId !== projectId) {
        throw new Error('Project canvas data reference is missing or inconsistent.');
      }
      if (payloadChanged) {
        await this.canvasData.update(project.canvasDataId, {
          jsonPayload,
          contentHash,
          payloadLength: jsonPayload.length,
          lastModified: new Date(),
          revision: nextRevision,
        });
      } else {
        await this.canvasData.update(project.canvasDataId, {
          lastModified: new Date(),
          revision: nextRevision,
        });
      }
      await this.projects.update(projectId, {
        name,
        lastModified: new Date(),
        thumbnail: this.normalizeThumbnail(thumbnail),
        contentHash,
        payloadLength: jsonPayload.length,
        revision: nextRevision,
        ...(editorMode ? { editorMode } : {}),
      });
      await waitForDurableWriteBoundary('update-project');
      return {
        status: 'saved' as const,
        projectId,
        revision: nextRevision,
      };
    });
  }

  async getProjectStorageDiagnostics(projectId: string): Promise<ProjectStorageDiagnostics | null> {
    assertIndexedDbStartupAllowed();
    const project = await this.projects.get(projectId);
    if (!project) return null;
    // Only materialize the one referenced payload. `primaryKeys()` reads
    // metadata/keys and avoids loading every potentially huge JSON row just
    // to report duplicate IDs.
    const rowIds = await this.canvasData.where('projectId').equals(projectId).primaryKeys();
    const referenced = await this.canvasData.get(project.canvasDataId);
    return {
      projectId,
      referencedCanvasDataId: referenced?.id || null,
      canvasDataRowCount: rowIds.length,
      duplicateCanvasDataIds: rowIds
        .filter((id) => id !== project.canvasDataId)
        .map((id) => String(id)),
      referencedPayloadLength: referenced?.jsonPayload.length || 0,
    };
  }

  async loadProject(projectId: string): Promise<{ project: Project; canvasData: string } | null> {
    assertIndexedDbStartupAllowed();
    return this.transaction('r', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project || project.quarantinedAt) return null;
      
      const canvasDataRecord = await this.canvasData.get(project.canvasDataId);
      if (!canvasDataRecord) return null;
      this.validateProjectPayload(canvasDataRecord.jsonPayload);
      
      return {
        project: {
          ...project,
          revision: normalizeProjectRevision(project.revision),
        },
        canvasData: canvasDataRecord.jsonPayload
      };
    });
  }

  async getAllProjects(): Promise<Project[]> {
    assertIndexedDbStartupAllowed();
    if (this.projectListRequest) return this.projectListRequest;
    const request = this.projects
      .orderBy('lastModified')
      .reverse()
      .filter((project) => !project.quarantinedAt)
      .limit(MAX_DASHBOARD_PROJECTS)
      .toArray()
      .then((projects) => projects.map((project) => ({
        ...project,
        revision: normalizeProjectRevision(project.revision),
        thumbnail: this.normalizeThumbnail(project.thumbnail),
      })))
      .finally(() => {
        if (this.projectListRequest === request) this.projectListRequest = null;
      });
    this.projectListRequest = request;
    return request;
  }

  async quarantineProject(projectId: string, reason: string): Promise<void> {
    assertIndexedDbStartupAllowed();
    const quarantinedAt = new Date().toISOString();
    await this.transaction('rw', this.projects, this.projectRecovery, async () => {
      await this.projects.update(projectId, { quarantinedAt, quarantineReason: reason });
      await this.projectRecovery.put({ projectId, quarantinedAt, reason });
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    assertIndexedDbStartupAllowed();
    return this.transaction('rw', this.projects, this.canvasData, this.projectRecovery, async () => {
      const project = await this.projects.get(projectId);
      if (!project) return;

      // Delete associated canvas data
      await this.canvasData.where('projectId').equals(projectId).delete();

      // Delete project
      await this.projects.delete(projectId);
      await this.projectRecovery.delete(projectId);
    });
  }

  async duplicateProject(projectId: string, newName: string): Promise<string> {
    assertIndexedDbStartupAllowed();
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project || project.quarantinedAt) throw new Error('Project not found');

      // Get the canvas data for the project
      const canvasDataRecord = await this.canvasData.get(project.canvasDataId);
      if (!canvasDataRecord) throw new Error('Canvas data not found');
      this.validateProjectPayload(canvasDataRecord.jsonPayload);
      const contentHash = project.contentHash || fingerprintProjectContent(canvasDataRecord.jsonPayload);

      // Create new IDs for the duplicated project
      const newProjectId = crypto.randomUUID();
      const newCanvasDataId = crypto.randomUUID();
      const revision = 1;

      // Create new canvas data record
      await this.canvasData.add({
        id: newCanvasDataId,
        jsonPayload: canvasDataRecord.jsonPayload,
        projectId: newProjectId,
        lastModified: new Date(),
        contentHash,
        payloadLength: canvasDataRecord.jsonPayload.length,
        revision,
      });

      // Create new project record
      await this.projects.add({
        id: newProjectId,
        name: newName,
        lastModified: new Date(),
        thumbnail: this.normalizeThumbnail(project.thumbnail),
        canvasDataId: newCanvasDataId,
        editorMode: project.editorMode,
        contentHash,
        payloadLength: canvasDataRecord.jsonPayload.length,
        revision,
      });

      return newProjectId;
    });
  }

  async renameProject(projectId: string, newName: string): Promise<void> {
    assertIndexedDbStartupAllowed();
    await this.transaction('rw', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project) throw new Error('Project not found');
      const revision = normalizeProjectRevision(project.revision) + 1;
      await this.projects.update(projectId, {
        name: newName,
        lastModified: new Date(),
        revision,
      });
      const referenced = await this.canvasData.get(project.canvasDataId);
      if (referenced && referenced.projectId === projectId) {
        await this.canvasData.update(project.canvasDataId, {
          lastModified: new Date(),
          revision,
        });
      }
    });
  }

  /**
   * Rename a project only when the caller still owns the revision it loaded.
   * Metadata changes participate in the same project/canvas revision stream
   * as scene writes so a stale dashboard or second window cannot silently
   * replace a newer project name.
   */
  async renameProjectIfRevision(
    projectId: string,
    newName: string,
    expectedRevision: number,
  ): Promise<ProjectWriteResult> {
    assertIndexedDbStartupAllowed();
    if (!Number.isFinite(expectedRevision) || expectedRevision < 1) {
      throw new Error('A valid durable project revision is required for compare-and-swap renames.');
    }
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project) throw new Error('Project not found');
      const actualRevision = normalizeProjectRevision(project.revision);
      const normalizedExpectedRevision = Math.trunc(expectedRevision);
      if (actualRevision !== normalizedExpectedRevision) {
        return {
          status: 'conflict' as const,
          projectId,
          expectedRevision: normalizedExpectedRevision,
          actualRevision,
        };
      }
      const referenced = await this.canvasData.get(project.canvasDataId);
      if (!referenced || referenced.projectId !== projectId) {
        throw new Error('Project canvas data reference is missing or inconsistent.');
      }
      const nextRevision = actualRevision + 1;
      const now = new Date();
      await this.projects.update(projectId, {
        name: newName,
        lastModified: now,
        revision: nextRevision,
      });
      await this.canvasData.update(project.canvasDataId, {
        lastModified: now,
        revision: nextRevision,
      });
      await waitForDurableWriteBoundary('rename-project');
      return {
        status: 'saved' as const,
        projectId,
        revision: nextRevision,
      };
    });
  }

  async getBrandKit(): Promise<BrandKit | null> {
    assertIndexedDbStartupAllowed();
    const brandKitRecords = await this.brandKit.toArray();
    return brandKitRecords.length > 0 ? brandKitRecords[0] : null;
  }

  async saveBrandKit(brandKit: BrandKit): Promise<string> {
    assertIndexedDbStartupAllowed();
    const existing = await this.getBrandKit();
    if (existing) {
      // Update existing brand kit - use put to replace the entire record
      await this.brandKit.put({ ...brandKit, id: existing.id });
      return existing.id!;
    } else {
      // Create new brand kit
      const id = await this.brandKit.add(brandKit);
      return id as string;
    }
  }

  async addColorToBrandKit(color: string): Promise<void> {
    assertIndexedDbStartupAllowed();
    const brandKit = await this.getBrandKit();
    if (brandKit) {
      const updatedColors = [...brandKit.colors, color];
      await this.brandKit.update(brandKit.id!, { colors: updatedColors });
    } else {
      const newBrandKit: BrandKit = {
        colors: [color],
        typography: {
          heading: { fontFamily: 'Arial', fontSize: 32, fontWeight: 'bold' },
          body: { fontFamily: 'Arial', fontSize: 16, fontWeight: 'normal' },
        },
        logoAssets: [],
      };
      await this.brandKit.add(newBrandKit);
    }
  }
}

export const db = new DesignSpaceDB();
