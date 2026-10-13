# Project instructions

## Project context
- Mealio is a household meal and ingredient library. Suggestions must come only from meals saved in the library; never invent recipes or imply unsaved recipes are stored.
- The app uses dependency-free HTML, CSS, and JavaScript ES modules. It defaults to browser IndexedDB; optional Supabase Auth/database/storage integration is implemented but remains config-first and is not connected to a provisioned cloud project yet.
- Keep local records intact. Any later transfer to shared storage must be explicit, repeatable, and preserve the local source until the user verifies the cloud copy.
- Persist structured records and uploaded photos. Ingredients have reusable stable IDs; meals refer to ingredient IDs. Normalize names for duplicate prevention while preserving user-facing spelling.
- Inspect the relevant code before changing it. Follow the current architecture and document deliberate changes here.
- Keep the app useful on mobile and desktop, support keyboard use, label form controls, and provide clear validation and empty states.

## Agent workflow
- For feature requests, coordinate through `team-lead` and delegate bounded work to the relevant specialists in `.github/agents/`.
- Use `product-planner` to clarify scope and acceptance criteria when needed. Assign implementation to the relevant frontend/backend specialist; avoid invoking roles that do not apply.
- After implementation, have `qa-engineer` create or update relevant tests and run the appropriate checks supported by the project. Report the exact commands and results; do not claim checks that were not run.
- Have `quality-reviewer` independently inspect the resulting diff and QA findings before finishing. The reviewer reports findings without editing code.
- Before consequential actions affecting the user's data, accounts, money, privacy, access, reputation, or external services, ask `security-guardian` for a read-only review. The guardian cannot authorize actions; obtain the user's explicit approval for the exact action and target. Never bypass approval prompts.
- Avoid having multiple agents edit the same files at once. The team lead owns integration and the final report.
- If the selected agent harness cannot invoke custom agents or subagents, perform the workflow sequentially where useful and say that delegation was unavailable.
- Read a matching skill in `.github/skills/` when its workflow applies; do not load unrelated skills.

## Change quality
- Preserve the project's existing user experience and technical constraints unless the request changes them.
- Consider accessibility, security, privacy, and failure cases relevant to the change.
- Prefer focused changes and explain material trade-offs in the handoff.
- Do not add third-party packages or send user data to a network service without a clear requirement.
