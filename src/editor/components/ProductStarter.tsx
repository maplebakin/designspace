import React from 'react';
import { shallow } from 'zustand/shallow';
import { PackageCheck, Sparkles } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { productRecipes } from '../recipes/recipeRegistry';
import type { ProductRecipe } from '../recipes/productRecipeTypes';
import { isUserObject } from '../utils/objectUtils';

type ProductStarterRecipeCard = {
  id: string;
  name: string;
  description: string;
  outputHint: string;
  version: string;
  testId: string;
  sourceRecipe: ProductRecipe;
};

const slugify = (value: string) => {
  const slug = value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'product-recipe';
};

const getRecipeDisplayName = (recipe: ProductRecipe) =>
  recipe.displayName?.trim() || recipe.name?.trim() || recipe.id;

const getRecipeDescription = (recipe: ProductRecipe) =>
  recipe.starterDescription?.trim()
  || recipe.productMetadataDefaults.description?.trim()
  || `Generate a ${recipe.pages.length}-page editable printable product from this recipe.`;

const getRecipeOutputHint = (recipe: ProductRecipe) => {
  if (recipe.starterOutputHint?.trim()) return recipe.starterOutputHint.trim();
  const includedFiles = recipe.productMetadataDefaults.includedFiles?.filter(Boolean);
  if (includedFiles?.length) return includedFiles.join(' + ');
  const formats = recipe.exportSettingsDefaults.formats?.join(' + ').toUpperCase();
  return formats ? `${formats} product export.` : 'Product-ready export settings included.';
};

export const buildProductStarterRecipeCards = (
  recipes: readonly ProductRecipe[] = productRecipes
): ProductStarterRecipeCard[] =>
  recipes.map((recipe) => ({
    id: recipe.id,
    name: getRecipeDisplayName(recipe),
    description: getRecipeDescription(recipe),
    outputHint: getRecipeOutputHint(recipe),
    version: recipe.version,
    testId: `recipe-${slugify(recipe.id)}`,
    sourceRecipe: recipe,
  }));

interface ProductStarterProps {
  onRecipeCreated?: (recipeId: string) => void;
  recipes?: readonly ProductRecipe[];
}

export const ProductStarter: React.FC<ProductStarterProps> = ({
  onRecipeCreated,
  recipes = productRecipes,
}) => {
  const {
    canvas,
    pages,
    isDirty,
    createProjectFromRecipe,
    setToastMessage,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      pages: state.pages,
      isDirty: state.isDirty,
      createProjectFromRecipe: state.createProjectFromRecipe,
      setToastMessage: state.setToastMessage,
    }),
    shallow
  );

  const productStarterRecipes = buildProductStarterRecipeCards(recipes);

  const handleCreateRecipe = async (recipe: ProductStarterRecipeCard) => {
    if (!canvas) {
      setToastMessage('Canvas is still loading.');
      return;
    }

    const hasUserCanvasObjects = canvas.getObjects().some(isUserObject);
    const hasUserPageContent = pages.some((page) =>
      Array.isArray(page?.canvasData?.objects)
      && page.canvasData.objects.some(isUserObject)
    );

    if (hasUserCanvasObjects || hasUserPageContent || isDirty) {
      const proceed = window.confirm(
        `Creating ${recipe.name} will clear your current design. Continue?`
      );
      if (!proceed) {
        setToastMessage(`${recipe.name} cancelled.`);
        return;
      }
    }

    const previousPages = useEditorStore.getState().pages;
    await createProjectFromRecipe(recipe.id);

    const nextState = useEditorStore.getState();
    const recipeWasCreated =
      nextState.productProjectFields?.recipe?.id === recipe.id
      && nextState.pages.length > 0
      && nextState.pages !== previousPages;

    if (recipeWasCreated) {
      onRecipeCreated?.(recipe.id);
    }
  };

  return (
    <div className="design-space-product-starter h-full overflow-y-auto p-4 text-[color:var(--ui-panel-text)]" data-testid="product-starter">
      <div className="design-space-product-starter-stack space-y-4">
        <div className="design-space-product-starter-hero rounded-2xl border border-[color:var(--brand-primary)]/30 bg-[color:var(--brand-primary)]/10 p-4">
          <div className="design-space-product-starter-hero-content flex items-start gap-3">
            <div className="design-space-product-starter-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="design-space-product-starter-title text-xs uppercase tracking-widest text-[color:var(--ui-text)]">
                Product Starter
              </h2>
              <p className="design-space-product-starter-description mt-1 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/75">
                Generate a complete editable printable product from a recipe.
              </p>
            </div>
          </div>
        </div>

        <div className="design-space-product-starter-recipes space-y-3">
          {productStarterRecipes.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              data-testid={recipe.testId}
              onClick={() => void handleCreateRecipe(recipe)}
              className="design-space-product-recipe-card w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition-all duration-200 hover:border-[color:var(--brand-primary)]/70 hover:bg-white/10"
            >
              <span className="design-space-product-recipe-content flex items-start gap-3">
                <span className="design-space-product-recipe-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[color:var(--brand-primary)]">
                  <PackageCheck className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="design-space-product-recipe-title block text-[11px] uppercase tracking-widest text-[color:var(--ui-text)]">
                    {recipe.name}
                  </span>
                  <span className="design-space-product-recipe-version mt-1 block text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/70">
                    Recipe v{recipe.version}
                  </span>
                  <span className="design-space-product-recipe-description mt-1 block text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
                    {recipe.description}
                  </span>
                  <span className="design-space-product-recipe-output mt-3 block rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/80">
                    {recipe.outputHint}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="design-space-product-starter-helper rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
            More templates and blank canvases remain available under Insert → Templates.
          </p>
        </div>
      </div>
    </div>
  );
};
