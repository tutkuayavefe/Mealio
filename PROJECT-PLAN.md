# Mealio: architecture and MVP plan

## Product goal

Help one household build a reusable meal library and quickly answer “what can I cook with these ingredients?” Search results are always saved meals from that library. The application never generates meal suggestions.

## MVP acceptance criteria

- Create, edit, and delete meals. A meal has a name, reusable ingredients, optional instructions, and an optional photo.
- Add an ingredient while creating a meal, then reuse it in any other meal without creating a duplicate (case and whitespace insensitive).
- Search by text and select multiple ingredients. Show only saved meals, ranked by how many selected ingredients match; with no selected ingredient, text search can match meal or ingredient names.
- Provide useful empty, validation, and error states.
- Work at mobile and desktop widths, and allow normal keyboard navigation.
- Keep all data and photos in the user's browser; no account or remote service is required.

## Data model

The browser database is `mealio`, schema version 1:

### `ingredients` object store

- `id`: stable UUID primary key
- `name`: display spelling
- `normalizedName`: trimmed, locale-lowercased name; unique index for duplicate prevention
- `createdAt`, `updatedAt`: ISO timestamps

### `meals` object store

- `id`: stable UUID primary key
- `name`: display name
- `normalizedName`: normalized name for search
- `ingredientIds`: array of stable ingredient IDs (many-to-many relationship)
- `instructions`: optional plain text
- `photo`: optional browser `Blob` stored locally
- `createdAt`, `updatedAt`: ISO timestamps

This keeps ingredient names canonical while allowing one ingredient to belong to many meals. A separate join store or server database can be introduced if future usage needs richer quantities, units, or multi-user sync.

## Architecture

- `index.html` provides the accessible page shell.
- `styles.css` owns responsive layout and visual system.
- `src/app.js` handles rendering, form interactions, search, and dialog behavior.
- `src/store.js` owns IndexedDB schema, validation, reusable ingredient creation, meal CRUD, and seeded starter entries.
- Browser-local IndexedDB is appropriate for a single-user MVP and supports photos without localStorage's small synchronous quota. It also avoids collecting personal cooking data on a server.
- Starter entries use only meals named in the product brief and are explicitly stored as library records. All search results come from stored meal records.

## Implementation plan

1. Adapt the agent template instructions and define this product's scope and data contract.
2. Have the product planner define acceptance criteria and data boundaries.
3. Implement the IndexedDB data layer and the responsive single-page interface in separate files.
4. Have QA verify ingredient reuse, CRUD, text and multi-ingredient search, empty states, photo handling, and mobile layout; add proportionate automated checks if the environment supports them.
5. Have the quality reviewer inspect the integrated changes and QA findings.

## Future extensions (outside the MVP)

Ingredient amounts and units, backups/export, multi-device sync, household sharing, and optional meal planning can be added without changing the core rule that recommendations come only from the saved library.
