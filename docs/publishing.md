# Publishing a release

Worklog ships two ways from the same repo:

- **Claude Code marketplace.** `.claude-plugin/marketplace.json` on `main` of
  `mahamadtohid-nonstopio/Karmavritta`. Users get updates when you push.
- **npm.** The `worklog-claude` package, which also provides the `worklog` terminal command.

## 1. Bump the version everywhere

The version must match in three files. `test/install.test.mjs` fails if they disagree:

- `package.json`: `"version"`
- `.claude-plugin/plugin.json`: `"version"`
- `.claude-plugin/marketplace.json`: `plugins[0].version`

Use semver: patch for fixes, minor for features, major for breaking changes
(including any data-format change, which also needs a migration; see rule 7).

## 2. Check before you ship

```bash
npm test                     # must report fail 0
claude plugin validate .     # manifests; an "icon missing" warning is fine
npm pack --dry-run           # the tarball contents
```

The tarball should contain `bin/`, `scripts/`, `hooks/`, `prompts/`,
`commands/`, `skills/`, `.claude-plugin/`, `CLAUDE.md`, `README.md`,
`LICENSE` and `package.json`, and nothing else: no `test/`, no `node_modules/`.
The `files` field in `package.json` controls this.

Before pushing, search for anything that must not be public (rule 6):

```bash
git grep -n -i -E "<your company>|<real ticket prefix>|<colleague names>|<internal host>"
```

## 3. Release to the marketplace

```bash
git commit -am "release: vX.Y.Z"
git tag -a vX.Y.Z -m "Worklog X.Y.Z"
git push origin main vX.Y.Z
```

Users update with `/plugin marketplace update karmavritta`, then `/worklog:setup`.

**If the push is rejected with `GH013 … Push cannot contain secrets`**, GitHub
push protection matched a token-shaped string. The planted values in
`test/redteam.test.mjs` are fabricated and are joined at runtime
(`j('xo', 'xb-', …)`) so they never match a scanner. Write any new planted
value the same way rather than clicking "allow".

## 4. Release to npm

One-time setup:

1. Create an account at https://www.npmjs.com/signup.
2. Turn on two-factor authentication (avatar → Account → Two-Factor Authentication).
   npm will not let you publish without it.
3. Log in from a real terminal window. The Claude Code `!` prompt can't answer
   npm's interactive questions.
   ```powershell
   npm login --auth-type=web
   ```

Every release, from a real terminal window:

```powershell
npm publish        # use npm 9 or newer for browser approval
```

`prepublishOnly` runs the tests first, so a failing build cannot publish.
npm then asks you to approve in the browser (passkey, Windows Hello or a
6-digit authenticator code).

**Staged publishing.** On a 2FA account npm may *stage* the version instead of
releasing it. The registry then shows a placeholder `0.0.0-stage`, and the real
version waits for you to approve it on npmjs.com (the package page or the link
printed after "Your package is …"). Check with:

```bash
npm view worklog-claude versions dist-tags
```

The release is done when `dist-tags.latest` is the new version.

### Common npm errors

| Error | Meaning and fix |
| --- | --- |
| `ENEEDAUTH` | Not logged in: `npm login --auth-type=web` |
| `Exit handler never called!` during login | Ran from a prompt with no keyboard input; use a real terminal |
| `E403 … Two-factor authentication … required` | Turn on 2FA, then publish again |
| `EOTP` | Needs approval or a one-time code; run in a real terminal to get the prompt |
| `E402 Payment Required` | Only for scoped `@scope/name` packages: add `--access public`. Public packages are free. |
| `E403` on a new name | The name is taken: `npm view <name>` |
