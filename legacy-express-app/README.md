# White Swan Staff

Rota, holiday, swaps, problems, announcements, events, sales and labour, payslips and right to work documents for the White Swan, Henley-in-Arden. Built so more venues can be added later.

## Run it on your own computer

You need Node.js 20 or newer and PostgreSQL 14 or newer.

1. Create a database and user, for example:
   `CREATE USER swan WITH PASSWORD 'swan_dev_pw'; CREATE DATABASE swan_staff OWNER swan;`
2. `npm install`
3. `npm run build` (builds the React app into `dist/`)
4. `npm run seed -- --reset` (demo data; wipes everything first, never run it on the real database)
5. `npm start`, then open http://localhost:8790

The server creates its tables on start (`server/migrations`).

## Demo logins

Password for all of them: `swan-demo-2026`

- Owner: owner@whiteswan.demo
- Manager: manager@whiteswan.demo
- Supervisor: supervisor@whiteswan.demo
- Staff: staff@whiteswan.demo (also jess@, tom@ and dan@whiteswan.demo)

## Settings for a real server

Put these in the host's environment, or in a `.env` file next to `package.json` that is never committed:

- `NODE_ENV=production`
- `DATABASE_URL=postgres://user:password@host:5432/dbname`
- `FILE_ENCRYPTION_KEY=` 64 hex characters (make one with `openssl rand -hex 32`). Keep a safe copy: without it, uploaded payslips and right to work files can't be opened.
- `STORAGE_DIR=` a folder on a persistent disk for the encrypted uploads
- `APP_URL=https://staff.example.co.uk`
- `PUBLIC_SITE_ORIGINS=https://whiteswanhenley.co.uk` (the website allowed to read published events from `/api/public`)
- `PORT` if the host needs a particular one

On a real server, don't run the demo seed. There's no script yet to create the first owner account, so one needs writing before the app goes live (one row each in `organisations`, `venues`, `users` and `memberships`; the password hash comes from `hashPassword` in `server/security.js`).
