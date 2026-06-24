import type {
  ExistingProjectPage,
  ProductAwareProjectPayload,
  ProjectExportSettings,
  ProjectProductMetadata,
} from '../project/projectSchema';
import type { ApocapaletteTheme } from '../types/apocapalette';
import type { UnitMode } from '../utils/units';

export type RecipeTokenRole = 'background' | 'primary' | 'accent' | 'text';

export type RecipeSemanticRole =
  | 'title'
  | 'heading'
  | 'prompt'
  | 'notesBlock'
  | 'checklist'
  | 'divider'
  | 'footer';

export type ProductRecipePageDefinition = {
  id: string;
  name: string;
  label: string;
  description?: string;
};

export type ProductRecipe = {
  id: string;
  version: string;
  name: string;
  displayName?: string;
  starterDescription?: string;
  starterOutputHint?: string;
  defaultPageSize: {
    presetId?: string;
    width: number;
    height: number;
    unitMode: UnitMode;
    dpi: number;
  };
  pages: ProductRecipePageDefinition[];
  productMetadataDefaults: ProjectProductMetadata & {
    titleTemplate: string;
  };
  exportSettingsDefaults: ProjectExportSettings & {
    fileSlug: string;
  };
};

export type GenerateProjectFromRecipeOptions = {
  theme?: ApocapaletteTheme | null;
  themeId?: string;
  projectId?: string;
  now?: string;
  projectName?: string;
};

export type GeneratedRecipeProject = ProductAwareProjectPayload<ExistingProjectPage>;
