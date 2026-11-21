# PostgreSQL migrations

Numbered SQL files run once, in filename order, inside a transaction. The
`schema_migrations` table records completed files; an advisory lock serializes
concurrent startup. Do not edit an applied migration. Add a new numbered file.

`001_initial.sql` creates the complete PostgreSQL schema for the SQLite cutover.
It is forward-only: there is deliberately no destructive automatic down
migration. Rollback uses the previous application and its SQLite backup. New
PostgreSQL writes must be reconciled separately before returning to SQLite.

Run `npm run db:migrate` from the repository root. Import existing data with
`npm run db:import -- data/stepone.sqlite` before first starting the new API.
