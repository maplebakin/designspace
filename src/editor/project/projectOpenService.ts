import { db, type DesignSpaceDB, type Project } from '../db';
import {
  normalizeDesignSpaceProjectPayload,
  type DesignSpaceProjectPayload,
  type EditorMode,
} from './projectSchema';

export const MAX_PROJECT_OPEN_FILE_BYTES = 100 * 1024 * 1024;

export type ProjectOpenInspection = {
  editorMode: EditorMode;
  projectName: string;
  payload: DesignSpaceProjectPayload;
};

export type LibraryProjectOpenInspection = ProjectOpenInspection & {
  libraryProjectId: string;
  libraryProject: Project;
};

type ProjectInspectionOptions = {
  fallbackName?: string;
  projectId?: string;
};

type ProjectLibraryReader = Pick<DesignSpaceDB, 'loadProject'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validatePortableProjectEnvelope = (payload: unknown) => {
  if (!isRecord(payload)) {
    throw new Error('Project file must contain a JSON object.');
  }
  if (payload.pages !== undefined && !Array.isArray(payload.pages)) {
    throw new Error('Project pages must be an array.');
  }
  if (
    payload.assets !== undefined
    && (
      !isRecord(payload.assets)
      || Object.values(payload.assets).some((source) => typeof source !== 'string')
    )
  ) {
    throw new Error('Project assets must be a map of image sources.');
  }
};

const getFileFallbackName = (fileName: string) =>
  fileName
    .replace(/\.apocaproject\.json$/i, '')
    .replace(/\.json$/i, '')
    .trim()
  || 'Untitled Project';

const readProjectFileText = async (file: File): Promise<string> => {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Project file could not be read.'));
    reader.readAsText(file);
  });
};

export const inspectDesignSpaceProjectPayload = (
  payload: unknown,
  options: ProjectInspectionOptions = {}
): ProjectOpenInspection => {
  validatePortableProjectEnvelope(payload);
  const normalized = normalizeDesignSpaceProjectPayload(payload, {
    projectName: options.fallbackName,
    projectId: options.projectId,
  }) as DesignSpaceProjectPayload;

  return {
    editorMode: normalized.editorMode,
    projectName: normalized.projectName,
    payload: normalized,
  };
};

export const inspectDesignSpaceProjectJson = (
  jsonPayload: string,
  options: ProjectInspectionOptions = {}
): ProjectOpenInspection => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch {
    throw new Error('Project file contains invalid JSON.');
  }
  return inspectDesignSpaceProjectPayload(parsed, options);
};

/**
 * Reads and normalizes a portable project before an editor shell is mounted.
 * Callers can route to the Fabric or DOM editor from the returned mode and pass
 * the normalized payload to the mode-specific store without reading the file
 * a second time.
 */
export const inspectDesignSpaceProjectFile = async (
  file: File
): Promise<ProjectOpenInspection> => {
  if (file.size > MAX_PROJECT_OPEN_FILE_BYTES) {
    throw new Error('Project file exceeds the 100 MB import limit.');
  }
  const jsonPayload = await readProjectFileText(file);
  return inspectDesignSpaceProjectJson(jsonPayload, {
    fallbackName: getFileFallbackName(file.name),
  });
};

/**
 * Loads the existing opaque JSON record once so the application can choose the
 * correct editor before mounting it. `canvasData` is a legacy database name;
 * document payloads are stored in the same generic JSON field.
 */
export const inspectLibraryProject = async (
  projectId: string,
  reader: ProjectLibraryReader = db
): Promise<LibraryProjectOpenInspection | null> => {
  const result = await reader.loadProject(projectId);
  if (!result) return null;

  const inspection = inspectDesignSpaceProjectJson(result.canvasData, {
    fallbackName: result.project.name,
    projectId,
  });
  const payload = {
    ...inspection.payload,
    projectName: result.project.name,
    metadata: {
      ...inspection.payload.metadata,
      name: result.project.name,
    },
  } as DesignSpaceProjectPayload;

  return {
    ...inspection,
    projectName: result.project.name,
    payload,
    libraryProjectId: projectId,
    libraryProject: result.project,
  };
};
