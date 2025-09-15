# Releasing (Manual)

This project uses manual releases controlled by the maintainer.

## Checklist

1) Ensure `main` is green (CI passing) and up to date
2) Update version in `package.json` using SemVer (patch/minor/major)
3) Update `CHANGELOG.md` (optional but recommended)
4) Build locally: `npm ci && npm run build && npm run test:unit`
5) Tag the release locally: `git tag -s vX.Y.Z && git push origin vX.Y.Z`
6) Create a GitHub Release for the tag with notes
7) If publishing to npm, enable 2FA and provenance and run `npm publish`

## Notes

- Only the maintainer should perform releases.
- Sign tags when possible and protect release tags on GitHub (e.g., `v*`).

