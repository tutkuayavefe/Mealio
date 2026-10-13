import { getCloudClient, getHouseholdId } from "./cloud-client.js";

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").normalize("NFKC").toLocaleLowerCase("tr");
}
function makeId() { return crypto.randomUUID(); }
function isUuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export async function initStore() {
  const householdId = await getHouseholdId();
  if (!householdId) throw new Error("NO_HOUSEHOLD");
}

export async function listData() {
  const client = await getCloudClient();
  const householdId = await getHouseholdId();
  const [{ data: ingredients, error: ingredientError }, { data: meals, error: mealError }] = await Promise.all([
    client.from("ingredients").select("id,name,normalized_name").eq("household_id", householdId),
    client.from("meals").select("id,name,normalized_name,instructions,photo_path,source_local_id,created_at,updated_at,meal_ingredients(ingredient_id)").eq("household_id", householdId),
  ]);
  if (ingredientError) throw ingredientError;
  if (mealError) throw mealError;
  const paths = meals.map((meal) => meal.photo_path).filter(Boolean);
  const signed = paths.length
    ? await client.storage.from("meal-photos").createSignedUrls(paths, 3600)
    : { data: [], error: null };
  if (signed.error) throw signed.error;
  const urlByPath = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
  return {
    ingredients: (ingredients ?? []).map((item) => ({ id: item.id, name: item.name, normalizedName: item.normalized_name })),
    meals: (meals ?? []).map((meal) => ({
      id: meal.id, name: meal.name, normalizedName: meal.normalized_name,
      ingredientIds: (meal.meal_ingredients ?? []).map((item) => item.ingredient_id),
      instructions: meal.instructions, photoUrl: meal.photo_path ? urlByPath.get(meal.photo_path) : undefined,
      photoPath: meal.photo_path, sourceLocalId: meal.source_local_id, createdAt: meal.created_at, updatedAt: meal.updated_at,
    })),
  };
}

export async function addIngredient(name, targetHouseholdId) {
  const client = await getCloudClient();
  const householdId = targetHouseholdId || await getHouseholdId();
  const display = name.trim().replace(/\s+/g, " ");
  const { data, error } = await client.rpc("add_household_ingredient", {
    target_household_id: householdId,
    ingredient_name: display,
    ingredient_normalized_name: normalize(display),
  });
  if (error) throw error;
  return { id: data.id, name: data.name, normalizedName: data.normalized_name };
}

export async function saveMeal({ id, sourceLocalId, name, instructions = "", ingredientIds, photo, targetHouseholdId } = {}) {
  const client = await getCloudClient();
  const householdId = targetHouseholdId || await getHouseholdId();
  const stableSourceLocalId = sourceLocalId ?? (id && !isUuid(id) ? id : null);
  const currentQuery = client.from("meals").select("id,photo_path,source_local_id").eq("household_id", householdId);
  const current = stableSourceLocalId
    ? await currentQuery.eq("source_local_id", stableSourceLocalId).maybeSingle()
    : id ? await currentQuery.eq("id", id).maybeSingle() : { data: null, error: null };
  if (current.error) throw current.error;
  const mealId = current.data?.id || (isUuid(id) ? id : makeId());
  const persistedSourceLocalId = current.data?.source_local_id ?? stableSourceLocalId;
  let photoPath = photo === null ? null : (current.data?.photo_path ?? null);
  if (photo instanceof Blob) {
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(photo.type)) throw new TypeError("Fotoğraf JPEG, PNG veya WebP olmalı.");
    if (photo.size > 5 * 1024 * 1024) throw new TypeError("Fotoğraf en fazla 5 MB olabilir.");
    const suffix = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[photo.type];
    photoPath = `${householdId}/${mealId}/${makeId()}.${suffix}`;
    const { error: uploadError } = await client.storage.from("meal-photos").upload(photoPath, photo, { contentType: photo.type, upsert: false });
    if (uploadError) throw uploadError;
  }
  const { error } = await client.rpc("save_household_meal", {
    target_household_id: householdId,
    target_meal_id: mealId,
    meal_name: name.trim(),
    meal_normalized_name: normalize(name),
    meal_instructions: instructions.trim(),
    ingredient_ids: [...new Set(ingredientIds)],
    target_photo_path: photoPath,
    target_source_local_id: persistedSourceLocalId,
  });
  if (error) {
    if (photo instanceof Blob && photoPath) await client.storage.from("meal-photos").remove([photoPath]);
    throw error;
  }
  if (current.data?.photo_path && current.data.photo_path !== photoPath) {
    await client.storage.from("meal-photos").remove([current.data.photo_path]);
  }
  return {
    id: mealId, name: name.trim(), normalizedName: normalize(name), instructions: instructions.trim(),
    ingredientIds: [...new Set(ingredientIds)], photoPath, sourceLocalId: persistedSourceLocalId, updatedAt: new Date().toISOString(),
  };
}

export async function deleteMeal(id) {
  const client = await getCloudClient();
  const householdId = await getHouseholdId();
  const { data: photoPath, error } = await client.rpc("delete_household_meal", { target_household_id: householdId, target_meal_id: id });
  if (error) throw error;
  if (photoPath) {
    const { error: storageError } = await client.storage.from("meal-photos").remove([photoPath]);
    if (storageError) console.warn("Meal photo cleanup failed; the private object can be removed later.", storageError);
  }
}

export async function getMeal(id) {
  return (await listData()).meals.find((meal) => meal.id === id);
}
