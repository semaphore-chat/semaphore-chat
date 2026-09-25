# Contributing

Thanks for your interest in contributing to Semaphore Chat! Whether it's a bug report, feature request, or code contribution, every bit helps.

## Ways to contribute

- **Report bugs** — Open a [GitHub issue](https://github.com/semaphore-chat/semaphore-chat/issues) with reproduction steps
- **Suggest features** — Open a discussion or issue describing what you'd like to see
- **Submit code** — Fix a bug, implement a feature, or improve documentation
- **Improve docs** — Fix typos, clarify instructions, or add missing guides

## Getting started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Set up** the [development environment](development-setup.md)
4. **Create a branch** for your changes
5. **Make your changes** following the patterns in the codebase
6. **Test** your changes — run the test suite and verify manually
7. **Submit a pull request** against the `main` branch

## Pull request guidelines

- Keep PRs focused — one feature or fix per PR
- Write descriptive commit messages
- Include tests for new features and bug fixes
- Add or update [sandbox stories](stories.md) for frontend UI you build or change, and show them with a [UI review](ui-review.md)
- Make sure existing tests pass before submitting
- Update documentation if your changes affect user-facing behavior

## Code style

- **Backend**: TypeScript with NestJS conventions, ESLint + Prettier
- **Frontend**: TypeScript with React, ESLint + Prettier
- Run `docker compose run --rm backend npm run lint` and `docker compose run --rm frontend npm run lint` before submitting (from a git worktree: `scripts/test-stack.sh <ticket> run-backend pnpm run lint` and `run-frontend pnpm run lint`; see [Test Stacks](testing.md#test-stacks-and-the-shared-docker-network))

## Reporting issues

When reporting a bug, include:

- Steps to reproduce
- Expected vs actual behavior
- Browser/OS/Docker version
- Relevant logs (`docker-compose logs backend` or browser console)

## Legal

By contributing to Semaphore Chat, you agree that your contribution may be included in both open-source (AGPLv3) and commercial distributions of Semaphore Chat.

## Questions?

Open a [GitHub issue](https://github.com/semaphore-chat/semaphore-chat/issues) or start a discussion — we're happy to help.
