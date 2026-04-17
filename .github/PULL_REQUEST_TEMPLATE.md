## Summary

<!-- 1-3 bullets describing what changed and why -->

## Test plan

- [ ] `npm test` passes locally
- [ ] `npm run build` produces a valid bundle
- [ ] `npm run package` succeeds and `verify-bundle` is green

## Generated-file snapshot review

Phase 1 of the test plan ([docs/e2e-extension-tester-plan.md](../docs/e2e-extension-tester-plan.md)) snapshots every file produced by `FileGenerator`. If this PR touched anything under `src/generator/templates/` or `src/generator/section-manager.ts`:

- [ ] I reviewed the snapshot diff in `src/generator/__snapshots__/file-generator.snapshot.test.ts.snap`
- [ ] The snapshot change is intentional and matches the user-facing template change described above
- [ ] I did **not** blindly run `vitest -u` — every diff line was read

(If this PR did not touch the generator, skip this section.)

## CHANGELOG / version

- [ ] `package.json` version bumped (if shippable)
- [ ] `CHANGELOG.md` entry added with today's date
