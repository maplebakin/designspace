import type { DocumentProjectPayload } from '../../editor/project/projectSchema';
import {
  validateDesignSpaceTheme,
  type DesignSpaceTheme,
  type DesignSpaceColorRole,
} from '../../utils/designSpaceTheme';
import {
  DEFAULT_DOCUMENT_STYLES,
  DOCUMENT_STYLE_IDS,
  type DocumentStyleId,
} from '../typography/documentTypography';

export const DOCUMENT_THEME_ROLES: Record<
  DocumentStyleId,
  DesignSpaceColorRole
> = {
  'article-title': 'heading',
  'subsection-heading': 'heading',
  body: 'text',
  quotation: 'text',
  caption: 'mutedText',
  'author-signature': 'mutedText',
};

/** Pure projection: preview never publishes a project replacement or history entry. */
export const projectDocumentTheme = (
  project: DocumentProjectPayload,
  input: DesignSpaceTheme
) => {
  const theme = validateDesignSpaceTheme(input);
  const previous = project.document.bridgeTheme;
  const styles = { ...project.document.styles };
  const preservedStyles: DocumentStyleId[] = [];
  for (const id of DOCUMENT_STYLE_IDS) {
    const role = DOCUMENT_THEME_ROLES[id];
    const current = styles[id];
    const linkedColor =
      previous?.colors[role] ?? DEFAULT_DOCUMENT_STYLES[id].color;
    if (current.color.toLowerCase() === linkedColor.toLowerCase()) {
      styles[id] = { ...current, color: theme.colors[role] };
    } else {
      preservedStyles.push(id);
    }
  }
  return {
    project: {
      ...project,
      document: {
        ...project.document,
        bridgeTheme: theme,
        background: {
          ...project.document.background,
          value: theme.colors.background,
        },
        styles,
      },
    },
    preservedStyles,
  };
};
