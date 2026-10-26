# Staff Hub frontend source (snapshot of 20 Oct 2026, 15:41 UTC)

This folder is the React/Vite source of the White Swan staff app as it stood when gh-pages commit 3790c9a
("Workspace layout") was built. It was copied from the build VM on 26 Oct 2026 so the source is on GitHub.

It is OLDER than the live app. It does not have the work from 21 Oct onwards, which exists only as the built
bundle in `public/` on main and on gh-pages:

- user types (Team member, Manager, Payroll, Owner) and the Payroll page
- notification Remove / Clear all
- Team page limited to owners and managers, and owner delete for people who have left
- the real White Swan logo and icons

The server files on main (`functions/`, `firestore.rules`, `storage.rules`) are newer than the copies this
snapshot was built against, so they are not included here.

Do not build this folder and deploy it over the live site, and do not copy its files over main's root:
it would remove the features above. Bring it up to date with the live bundle first.

Build locally: `npm install && npm run build` (output goes to `dist/`, base path `/twsched/`).
