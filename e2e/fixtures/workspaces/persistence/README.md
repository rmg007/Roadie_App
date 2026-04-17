# Persistence E2E fixture

Minimal workspace used by `e2e/suites/persistence.suite.js` to verify that
workflow history written to `.github/.roadie/project-model.db` survives a
VS Code window reload.

The database is seeded on-demand by `e2e/fixtures/seed-persistence-db.js` —
do not commit the generated `.db` files. See `.gitignore` in this directory.
