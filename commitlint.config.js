// Conventional Commits 1.0.0, limited to the types allowed in CLAUDE.md §7.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'chore', 'refactor', 'test']],
  },
}
