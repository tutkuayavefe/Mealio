const DATABASE_NAME = "mealio";
const DATABASE_VERSION = 4;

let databasePromise;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "mealio-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

function normalizeName(name) {
  if (typeof name !== "string") throw new TypeError("Name must be a string.");
  const displayName = name.trim().replace(/\s+/g, " ");
  if (!displayName) throw new TypeError("Name cannot be empty.");
  return { name: displayName, normalizedName: displayName.normalize("NFKC").toLocaleLowerCase() };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

function seedLibrary(ingredientStore, mealStore, existingIngredients = []) {
  // Persist only meal examples explicitly provided in the product request.
  const ingredientNames = ["Tavuk göğsü", "Makarna", "Spätzle", "Bulgur", "Nohut", "Pirinç"];
  const byName = new Map(existingIngredients.map((ingredient) => [ingredient.normalizedName, ingredient.id]));
  for (const name of ingredientNames) {
    const normalized = normalizeName(name);
    if (byName.has(normalized.normalizedName)) continue;
    const id = makeId();
    ingredientStore.add({ id, ...normalized, createdAt: new Date().toISOString() });
    byName.set(normalized.normalizedName, id);
  }
  const chicken = byName.get("tavuk göğsü");
  const timestamp = new Date().toISOString();
  const examples = [
    { name: "Tavuklu makarna", ingredientIds: [chicken, byName.get("makarna")] },
    { name: "Tavuklu spätzle", ingredientIds: [byName.get("spätzle"), chicken] },
    { name: "Tavuklu bulgur", ingredientIds: [byName.get("bulgur"), chicken] },
    { name: "Nohutlu pilav ve haşlama tavuk", ingredientIds: [chicken, byName.get("nohut"), byName.get("pirinç")] },
  ];
  for (const meal of examples) {
    mealStore.add({ id: makeId(), ...meal, instructions: "", createdAt: timestamp, updatedAt: timestamp });
  }
}

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("Mealio needs IndexedDB, which is unavailable in this browser context."));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const upgrade = request.transaction;
      const ingredients = db.objectStoreNames.contains("ingredients")
        ? upgrade.objectStore("ingredients")
        : db.createObjectStore("ingredients", { keyPath: "id" });
      if (!ingredients.indexNames.contains("normalizedName")) {
        ingredients.createIndex("normalizedName", "normalizedName", { unique: true });
      }
      const meals = db.objectStoreNames.contains("meals")
        ? upgrade.objectStore("meals")
        : db.createObjectStore("meals", { keyPath: "id" });
      if (!meals.indexNames.contains("name")) meals.createIndex("name", "name");
      const meta = db.objectStoreNames.contains("meta")
        ? upgrade.objectStore("meta")
        : db.createObjectStore("meta", { keyPath: "id" });
      const marker = meta.get("starter-meals-v1");
      marker.onsuccess = () => {
        if (marker.result) return;
        const mealCount = meals.count();
        mealCount.onsuccess = () => {
          if (mealCount.result === 0) {
            const existing = ingredients.getAll();
            existing.onsuccess = () => seedLibrary(ingredients, meals, existing.result);
          }
          meta.put({ id: "starter-meals-v1", appliedAt: new Date().toISOString() });
        };
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error || new Error("Could not open Mealio's local database."));
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error("Mealio's database is blocked by another open tab. Close other Mealio tabs and try again."));
    };
  });
  return databasePromise;
}

export async function initStore() {
  await openDatabase();
}

export async function listData() {
  const db = await openDatabase();
  const transaction = db.transaction(["ingredients", "meals"], "readonly");
  const done = transactionDone(transaction);
  const [ingredients, meals] = await Promise.all([
    requestResult(transaction.objectStore("ingredients").getAll()),
    requestResult(transaction.objectStore("meals").getAll()),
  ]);
  await done;
  ingredients.sort((a, b) => a.name.localeCompare(b.name));
  meals.sort((a, b) => a.name.localeCompare(b.name));
  return { ingredients, meals };
}

export async function addIngredient(name) {
  const normalized = normalizeName(name);
  const db = await openDatabase();
  const transaction = db.transaction("ingredients", "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore("ingredients");
  const existing = await requestResult(store.index("normalizedName").get(normalized.normalizedName));
  if (existing) {
    await done;
    return existing;
  }
  const ingredient = { id: makeId(), ...normalized, createdAt: new Date().toISOString() };
  await requestResult(store.add(ingredient));
  await done;
  return ingredient;
}

export async function saveMeal({ id, name, instructions = "", ingredientIds, photo } = {}) {
  const normalized = normalizeName(name);
  if (typeof instructions !== "string") throw new TypeError("Instructions must be a string.");
  if (!Array.isArray(ingredientIds) || ingredientIds.length === 0 || ingredientIds.some((item) => typeof item !== "string")) {
    throw new TypeError("A meal must have at least one valid ingredient ID.");
  }
  if (photo !== undefined && photo !== null && !(photo instanceof Blob)) {
    throw new TypeError("Photo must be a Blob, null, or omitted.");
  }
  const db = await openDatabase();
  const transaction = db.transaction(["ingredients", "meals"], "readwrite");
  const done = transactionDone(transaction);
  const ingredientStore = transaction.objectStore("ingredients");
  const mealStore = transaction.objectStore("meals");
  const uniqueIngredientIds = [...new Set(ingredientIds)];
  const ingredientRecords = await Promise.all(uniqueIngredientIds.map((ingredientId) => requestResult(ingredientStore.get(ingredientId))));
  if (ingredientRecords.some((ingredient) => !ingredient)) {
    transaction.abort();
    try { await done; } catch { /* Expected after abort. */ }
    throw new TypeError("Every meal ingredient must already exist in the ingredient library.");
  }
  const previous = id ? await requestResult(mealStore.get(id)) : undefined;
  if (id && !previous) {
    transaction.abort();
    try { await done; } catch { /* Expected after abort. */ }
    throw new TypeError("The meal to update does not exist.");
  }
  const now = new Date().toISOString();
  const meal = {
    id: id || makeId(),
    ...normalized,
    instructions: instructions.trim(),
    ingredientIds: uniqueIngredientIds,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  if (photo !== null && photo !== undefined) meal.photo = photo;
  else if (photo === undefined && previous?.photo) meal.photo = previous.photo;
  await requestResult(mealStore.put(meal));
  await done;
  return meal;
}

export async function deleteMeal(id) {
  if (typeof id !== "string" || !id) throw new TypeError("A meal ID is required.");
  const db = await openDatabase();
  const transaction = db.transaction("meals", "readwrite");
  const done = transactionDone(transaction);
  await requestResult(transaction.objectStore("meals").delete(id));
  await done;
}

export async function getMeal(id) {
  if (typeof id !== "string" || !id) throw new TypeError("A meal ID is required.");
  const db = await openDatabase();
  const transaction = db.transaction("meals", "readonly");
  const done = transactionDone(transaction);
  const meal = await requestResult(transaction.objectStore("meals").get(id));
  await done;
  return meal;
}
