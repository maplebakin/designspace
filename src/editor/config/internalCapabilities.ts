declare const __DESIGN_SPACE_INTERNAL_PRODUCT_FORGE__: boolean;

// Tests exercise the internal workflow directly. Production builds must opt in
// explicitly through DESIGN_SPACE_INTERNAL_PRODUCT_FORGE=true in vite.config.ts.
export const INTERNAL_PRODUCT_FORGE_ENABLED =
  import.meta.env.MODE === 'test'
  || (
    typeof __DESIGN_SPACE_INTERNAL_PRODUCT_FORGE__ !== 'undefined'
    && __DESIGN_SPACE_INTERNAL_PRODUCT_FORGE__
  );
