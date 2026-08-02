import Dexie, { Table } from 'dexie';
import type { EditorMode } from './project/projectSchema';
import { assertIndexedDbStartupAllowed } from './persistence/startupStorageRecovery';

export const MAX_LIBRARY_PROJECT_CHARS = 100 * 1024 * 1024;
export const MAX_LIBRARY_THUMBNAIL_CHARS = 2 * 1024 * 1024;
export const MAX_DASHBOARD_PROJECTS = 100;

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
    assertIndexedDbStartupAllowed();
    this.validateProjectPayload(jsonPayload);
    const projectId = crypto.randomUUID();
    const canvasDataId = crypto.randomUUID();
    const contentHash = fingerprintProjectPayload(jsonPayload);
    
    // Create transaction to ensure both records are saved together
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      // Save canvas data
      await this.canvasData.add({
        id: canvasDataId,
        jsonPayload,
        projectId,
        contentHash,
        payloadLength: jsonPayload.length,
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
      });
      
      return projectId;
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
    const contentHash = fingerprintProjectPayload(jsonPayload);
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project) throw new Error('Project not found');
      const payloadChanged = project.contentHash !== contentHash
        || project.payloadLength !== jsonPayload.length;
      if (payloadChanged) {
        // A legacy database may contain superseded rows with the same
        // projectId. Update only the row explicitly referenced by the project
        // record; rewriting the whole index was the source of unbounded
        // persistence growth during recovery.
        const referenced = await this.canvasData.get(project.canvasDataId);
        if (!referenced || referenced.projectId !== projectId) {
          throw new Error('Project canvas data reference is missing or inconsistent.');
        }
        await this.canvasData.update(project.canvasDataId, {
          jsonPayload,
          contentHash,
          payloadLength: jsonPayload.length,
          lastModified: new Date(),
        });
      }
      
      // Update project
      await this.projects.update(projectId, {
        name,
        lastModified: new Date(),
        thumbnail: this.normalizeThumbnail(thumbnail),
        contentHash,
        payloadLength: jsonPayload.length,
        ...(editorMode ? { editorMode } : {}),
      });
      return payloadChanged;
    });
  }

  async getProjectStorageDiagnostics(projectId: string): Promise<ProjectStorageDiagnostics | null> {
    assertIndexedDbStartupAllowed();
    const project = await this.projects.get(projectId);
    if (!project) return null;
    const rows = await this.canvasData.where('projectId').equals(projectId).toArray();
    const referenced = rows.find((row) => row.id === project.canvasDataId);
    return {
      projectId,
      referencedCanvasDataId: referenced?.id || null,
      canvasDataRowCount: rows.length,
      duplicateCanvasDataIds: rows
        .filter((row) => row.id !== project.canvasDataId)
        .map((row) => row.id),
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
        project,
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
      const contentHash = project.contentHash || fingerprintProjectPayload(canvasDataRecord.jsonPayload);

      // Create new IDs for the duplicated project
      const newProjectId = crypto.randomUUID();
      const newCanvasDataId = crypto.randomUUID();

      // Create new canvas data record
      await this.canvasData.add({
        id: newCanvasDataId,
        jsonPayload: canvasDataRecord.jsonPayload,
        projectId: newProjectId,
        lastModified: new Date(),
        contentHash,
        payloadLength: canvasDataRecord.jsonPayload.length,
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
      });

      return newProjectId;
    });
  }

  async renameProject(projectId: string, newName: string): Promise<void> {
    assertIndexedDbStartupAllowed();
    await this.projects.update(projectId, {
      name: newName,
      lastModified: new Date(),
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
