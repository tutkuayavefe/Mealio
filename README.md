# Mealio

Mealio is a personal meal library for finding dishes that use the ingredients you have at home. It only recommends meals saved in your own library.

## Run locally

The app has no package dependencies. From this folder, start a local static server:

```sh
python3 -m http.server 4173
```

Then open <http://127.0.0.1:4173>. Keep using the same browser profile to access your locally stored meals and photos.

## MVP features

- Save and edit meals, optional instructions, and meal photos.
- Add ingredients once and reuse them across meals.
- Search saved meals by name, ingredient text, or multiple selected ingredients.
- Store data in the browser's IndexedDB. Nothing is uploaded to a server.

The architecture and acceptance criteria are in [PROJECT-PLAN.md](PROJECT-PLAN.md). The `.github/agents/` folder contains the reusable agent team roles from the template.

## Agent action approvals

The read-only `security-guardian` reviews consequential actions; only the user can approve them. The VS Code Local pre-tool hook in `.github/hooks/` asks for approval for covered high-impact commands, external mutations, and edits to the security policy. Hooks require a trusted workspace and `chat.useHooks`; coverage depends on the selected agent harness. They are not a universal security boundary.
