import {
  createRecipeVersion,
  hasRecipeChanged,
  isExternalRecipeDifferent,
  type Recipe,
} from "./recipe-calc";

export type ExternalUpdateResolution =
  | { action: "clear-conflict" }
  | { action: "auto-sync"; nextRecipe: Recipe; nextBase: Recipe }
  | { action: "conflict"; latestExternal: Recipe; keepAcknowledged: boolean };

export function resolveExternalRecipeUpdate(params: {
  baseRecipe: Recipe;
  currentDraft: Recipe;
  storedRecipe: Recipe;
  acknowledgedExternal: Recipe | null;
}): ExternalUpdateResolution {
  const { baseRecipe, currentDraft, storedRecipe, acknowledgedExternal } = params;

  if (!isExternalRecipeDifferent(baseRecipe, storedRecipe)) {
    return { action: "clear-conflict" };
  }

  const userHasLocalEdits = hasRecipeChanged(baseRecipe, currentDraft);
  if (!userHasLocalEdits) {
    const fresh = structuredClone(storedRecipe);
    return {
      action: "auto-sync",
      nextRecipe: fresh,
      nextBase: structuredClone(fresh),
    };
  }

  const keepAcknowledged = acknowledgedExternal
    ? !isExternalRecipeDifferent(acknowledgedExternal, storedRecipe)
    : false;

  return {
    action: "conflict",
    latestExternal: structuredClone(storedRecipe),
    keepAcknowledged,
  };
}

export type SaveValidationResult =
  | { status: "missing-name" }
  | { status: "conflict-unacknowledged"; latestExternal: Recipe }
  | { status: "conflict-confirm"; latestExternal: Recipe }
  | { status: "ok" };

export function validateRecipeSave(params: {
  baseRecipe: Recipe;
  currentDraft: Recipe;
  latestStored: Recipe | undefined;
  isExisting: boolean;
  conflictAcknowledged: boolean;
  acknowledgedExternal: Recipe | null;
  forceSave?: boolean;
}): SaveValidationResult {
  const {
    baseRecipe,
    currentDraft,
    latestStored,
    isExisting,
    conflictAcknowledged,
    acknowledgedExternal,
    forceSave = false,
  } = params;

  if (!currentDraft.name.trim()) {
    return { status: "missing-name" };
  }

  if (isExisting && latestStored) {
    const isConflicted = isExternalRecipeDifferent(baseRecipe, latestStored);
    if (isConflicted && !forceSave) {
      const isAcknowledgedForLatest =
        conflictAcknowledged &&
        acknowledgedExternal !== null &&
        !isExternalRecipeDifferent(acknowledgedExternal, latestStored);

      if (isAcknowledgedForLatest) {
        return {
          status: "conflict-confirm",
          latestExternal: structuredClone(latestStored),
        };
      }

      return {
        status: "conflict-unacknowledged",
        latestExternal: structuredClone(latestStored),
      };
    }
  }

  return { status: "ok" };
}

export function buildSavedRecipe(params: {
  baseRecipe: Recipe;
  currentDraft: Recipe;
  latestStored: Recipe | undefined;
  isExisting: boolean;
}): Recipe {
  const { baseRecipe, currentDraft, latestStored, isExisting } = params;
  let next: Recipe = { ...currentDraft, updatedAt: new Date().toISOString() };

  if (isExisting) {
    if (latestStored && isExternalRecipeDifferent(baseRecipe, latestStored)) {
      next = {
        ...next,
        versionHistory: structuredClone(latestStored.versionHistory || []),
      };
      next = createRecipeVersion(next, latestStored, "Atualização local sobre versão externa");
    } else if (hasRecipeChanged(baseRecipe, currentDraft)) {
      next = createRecipeVersion(next, baseRecipe, "Atualização da receita");
    }
  }

  return next;
}
