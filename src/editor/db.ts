import Dexie, { Table } from 'dexie';

export interface Project {
  id?: string;
  name: string;
  lastModified: Date;
  thumbnail?: string; // Base64 encoded thumbnail
  canvasDataId: string; // Reference to canvasData entry
}

export interface CanvasData {
  id: string;
  jsonPayload: string; // JSON string of canvas data
  projectId: string; // Reference to project
  lastModified?: Date; // Optional last modified date
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

export class DesignSpaceDB extends Dexie {
  projects!: Table<Project>;
  canvasData!: Table<CanvasData>;
  brandKit!: Table<BrandKit>;

  constructor() {
    super('DesignSpaceDB');
    this.version(3).stores({
      projects: '++id, name, lastModified, thumbnail, canvasDataId',
      canvasData: 'id, jsonPayload, projectId, lastModified',
      brandKit: '++id, colors, typography, logoAssets',
    });

    // Create indexes
    this.projects = this.table('projects');
    this.canvasData = this.table('canvasData');
    this.brandKit = this.table('brandKit');
  }

  async saveProject(name: string, jsonPayload: string, thumbnail?: string): Promise<string> {
    const projectId = crypto.randomUUID();
    const canvasDataId = crypto.randomUUID();
    
    // Create transaction to ensure both records are saved together
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      // Save canvas data
      await this.canvasData.add({
        id: canvasDataId,
        jsonPayload,
        projectId
      });
      
      // Save project
      await this.projects.add({
        id: projectId,
        name,
        lastModified: new Date(),
        thumbnail,
        canvasDataId
      });
      
      return projectId;
    });
  }

  async updateProject(projectId: string, name: string, jsonPayload: string, thumbnail?: string): Promise<void> {
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      // Update canvas data
      await this.canvasData.where('projectId').equals(projectId).modify({
        jsonPayload
      });
      
      // Update project
      await this.projects.update(projectId, {
        name,
        lastModified: new Date(),
        thumbnail
      });
    });
  }

  async loadProject(projectId: string): Promise<{ project: Project; canvasData: string } | null> {
    return this.transaction('r', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project) return null;
      
      const canvasDataRecord = await this.canvasData.get(project.canvasDataId);
      if (!canvasDataRecord) return null;
      
      return {
        project,
        canvasData: canvasDataRecord.jsonPayload
      };
    });
  }

  async getAllProjects(): Promise<Project[]> {
    return this.projects.orderBy('lastModified').reverse().toArray();
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project) return;

      // Delete associated canvas data
      await this.canvasData.where('projectId').equals(projectId).delete();

      // Delete project
      await this.projects.delete(projectId);
    });
  }

  async duplicateProject(projectId: string, newName: string): Promise<string> {
    return this.transaction('rw', this.projects, this.canvasData, async () => {
      const project = await this.projects.get(projectId);
      if (!project) throw new Error('Project not found');

      // Get the canvas data for the project
      const canvasDataRecord = await this.canvasData.get(project.canvasDataId);
      if (!canvasDataRecord) throw new Error('Canvas data not found');

      // Create new IDs for the duplicated project
      const newProjectId = crypto.randomUUID();
      const newCanvasDataId = crypto.randomUUID();

      // Create new canvas data record
      await this.canvasData.add({
        id: newCanvasDataId,
        jsonPayload: canvasDataRecord.jsonPayload,
        projectId: newProjectId,
        lastModified: new Date()
      });

      // Create new project record
      await this.projects.add({
        id: newProjectId,
        name: newName,
        lastModified: new Date(),
        thumbnail: project.thumbnail, // Copy the thumbnail
        canvasDataId: newCanvasDataId
      });

      return newProjectId;
    });
  }

  async renameProject(projectId: string, newName: string): Promise<void> {
    await this.projects.update(projectId, {
      name: newName,
      lastModified: new Date(),
    });
  }

  async getBrandKit(): Promise<BrandKit | null> {
    const brandKitRecords = await this.brandKit.toArray();
    return brandKitRecords.length > 0 ? brandKitRecords[0] : null;
  }

  async saveBrandKit(brandKit: BrandKit): Promise<string> {
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
