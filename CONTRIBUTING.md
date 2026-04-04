# Contributing to ADO Terraform Agent

Thanks for your interest in contributing!

## Ground rules

- Be respectful — follow the [Code of Conduct](./CODE_OF_CONDUCT.md)
- For security issues, follow [SECURITY.md](./SECURITY.md) — do not open public issues

## Development flow

1. Fork the repository
2. Create a feature branch from `main`
3. Make focused changes
4. Open a pull request targeting `main`

## Pull request requirements

- CI checks must pass
- At least 1 approval required
- Keep PRs small and focused
- Update documentation when behavior changes

## Local development

```bash
# Task
cd tasks/Terraform && npm install && npm run build

# UI
cd ui && npm install && npm run build

# Package VSIX
npm run package
```

## Issues

Use the issue templates. Include reproduction steps and expected behavior.
