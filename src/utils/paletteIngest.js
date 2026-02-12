function ingestApocapalette(rawPalette) {
  const result = {
    name: rawPalette.name,
    mode: rawPalette.mode,
    categories: {}
  };

  if (rawPalette.canvasBackground !== undefined || rawPalette.panelBackground !== undefined || rawPalette.surfaceBackground !== undefined) {
    result.categories.backgrounds = {};
    if (rawPalette.canvasBackground !== undefined) result.categories.backgrounds.canvas = rawPalette.canvasBackground;
    if (rawPalette.panelBackground !== undefined) result.categories.backgrounds.panel = rawPalette.panelBackground;
    if (rawPalette.surfaceBackground !== undefined) result.categories.backgrounds.surface = rawPalette.surfaceBackground;
  }

  if (rawPalette.textPrimary !== undefined || rawPalette.textSecondary !== undefined || rawPalette.textOnBrand !== undefined) {
    result.categories.text = {};
    if (rawPalette.textPrimary !== undefined) result.categories.text.primary = rawPalette.textPrimary;
    if (rawPalette.textSecondary !== undefined) result.categories.text.secondary = rawPalette.textSecondary;
    if (rawPalette.textOnBrand !== undefined) result.categories.text.onBrand = rawPalette.textOnBrand;
  }

  if (rawPalette.brandPrimary !== undefined || rawPalette.brandSecondary !== undefined || rawPalette.brandAccent !== undefined) {
    result.categories.brand = {};
    if (rawPalette.brandPrimary !== undefined) result.categories.brand.primary = rawPalette.brandPrimary;
    if (rawPalette.brandSecondary !== undefined) result.categories.brand.secondary = rawPalette.brandSecondary;
    if (rawPalette.brandAccent !== undefined) result.categories.brand.accent = rawPalette.brandAccent;
  }

  if (rawPalette.interactiveDefault !== undefined || rawPalette.interactiveHover !== undefined || rawPalette.interactiveActive !== undefined) {
    result.categories.interactive = {};
    if (rawPalette.interactiveDefault !== undefined) result.categories.interactive.default = rawPalette.interactiveDefault;
    if (rawPalette.interactiveHover !== undefined) result.categories.interactive.hover = rawPalette.interactiveHover;
    if (rawPalette.interactiveActive !== undefined) result.categories.interactive.active = rawPalette.interactiveActive;
  }

  if (rawPalette.statusSuccess !== undefined || rawPalette.statusWarning !== undefined || rawPalette.statusError !== undefined) {
    result.categories.status = {};
    if (rawPalette.statusSuccess !== undefined) result.categories.status.success = rawPalette.statusSuccess;
    if (rawPalette.statusWarning !== undefined) result.categories.status.warning = rawPalette.statusWarning;
    if (rawPalette.statusError !== undefined) result.categories.status.error = rawPalette.statusError;
  }

  if (rawPalette.neutralBorder !== undefined || rawPalette.neutralDivider !== undefined || rawPalette.neutralDisabled !== undefined || rawPalette.neutralShadow100 !== undefined || rawPalette.neutralShadow200 !== undefined) {
    result.categories.neutrals = {};
    if (rawPalette.neutralBorder !== undefined) result.categories.neutrals.border = rawPalette.neutralBorder;
    if (rawPalette.neutralDivider !== undefined) result.categories.neutrals.divider = rawPalette.neutralDivider;
    if (rawPalette.neutralDisabled !== undefined) result.categories.neutrals.disabled = rawPalette.neutralDisabled;
    if (rawPalette.neutralShadow100 !== undefined) result.categories.neutrals.shadow100 = rawPalette.neutralShadow100;
    if (rawPalette.neutralShadow200 !== undefined) result.categories.neutrals.shadow200 = rawPalette.neutralShadow200;
  }

  return result;
}

export { ingestApocapalette };
