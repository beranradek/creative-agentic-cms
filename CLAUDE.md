# Creative Agentic CMS - Instructions for agents

See README.md (MUST read) for system overview.

## Technology Stack

- TypeScript
- LangChain.js for agent implementation
- LLM provider | OpenAI (configurable model, default: latest gpt-xxx model). Direct connection via `@langchain/openai`. LiteLLM proxy deferred to future iteration. |
  - **Circuit breaker** on the LLM channel (OpenAI).
- CI/CD - GitHub Actions

Do not use any new libraries with commercial licenses required.

## Coding Standards

### TypeScript
- **Strict mode** always (`"strict": true` in tsconfig.json)
- **ES Modules** (not CommonJS)
- Runtime validation with **Zod** at system boundaries (API inputs, external data, config)
- Prefer `interface` over `type` for object shapes
- No `any` — use `unknown` + narrowing when type is truly unknown
- Named exports, no default exports

### Testing
- **Vitest** as the test runner
- Unit tests alongside source files (`*.test.ts`) or in `tests/unit/`
- Integration tests in `tests/integration/`
- E2E tests in `tests/e2e/`

### Naming Conventions
- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

### Dependencies
- Pin exact versions in `package.json` (no `^` or `~`)
- Use `pnpm` as package manager

### Build & Test
```bash
pnpm install
pnpm build          # tsc
pnpm test           # vitest
pnpm test:e2e       # e2e tests
```

## Documentation

- Diagrams: Mermaid (never ASCII art)
- Language: English for all code and documentation
