export const SYSTEM_OBJECT_FLAGS = [
  'isGuide',
  'isSmartGuide',
  'isDocumentPaper',
  'isPageBorder',
  'isSafeZoneOverlay',
  'isPersistentGuide',
  'excludeFromExport',
] as const;

export const isUserObject = (object: any): boolean =>
  SYSTEM_OBJECT_FLAGS.every((flag) => !object?.[flag]);
