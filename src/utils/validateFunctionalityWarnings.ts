import smartGuidesCode from '../editor/fabric/smartGuides.ts?raw';
import guideRegistryCode from '../editor/fabric/guideRegistry.ts?raw';
import alignmentCode from '../editor/fabric/alignment.ts?raw';
import zIndexCode from '../editor/fabric/zIndexManifest.ts?raw';

export const getValidationWarnings = () => {
  const warnings: string[] = [];

  if (!smartGuidesCode.includes('enforceZOrder(canvas);')) {
    warnings.push('Smart guides are missing z-order enforcement.');
  }
  if (!guideRegistryCode.includes('class GuideRegistry')) {
    warnings.push('Guide registry implementation is incomplete.');
  }
  if (!alignmentCode.includes('alignLeft') || !alignmentCode.includes('distributeVertically')) {
    warnings.push('Alignment helpers are missing expected functions.');
  }
  if (!zIndexCode.includes('enum CanvasLayer')) {
    warnings.push('z-index manifest enum is missing.');
  }

  return warnings;
};
