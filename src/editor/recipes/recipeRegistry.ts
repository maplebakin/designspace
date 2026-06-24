import { chaosCraftPlannerRecipe } from './chaosCraftPlanner';
import { crochetPatternDecoderRecipe } from './crochetPatternDecoder';
import type { ProductRecipe } from './productRecipeTypes';

export const productRecipes = [
  chaosCraftPlannerRecipe,
  crochetPatternDecoderRecipe,
] as const satisfies readonly ProductRecipe[];

export type ProductRecipeId = typeof productRecipes[number]['id'];

export const productRecipeRegistry: Record<ProductRecipeId, ProductRecipe> = productRecipes.reduce(
  (registry, recipe) => ({
    ...registry,
    [recipe.id]: recipe,
  }),
  {} as Record<ProductRecipeId, ProductRecipe>
);

export const getProductRecipe = (recipeId: ProductRecipeId | string): ProductRecipe | undefined =>
  productRecipeRegistry[recipeId as ProductRecipeId];
