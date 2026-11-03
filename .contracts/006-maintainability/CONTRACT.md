---
name: universe-maintainability
message: Keep responsibilities focused and checks tied to consequential behavior.
---

## Rules

Name modules for their responsibility. Keep cohesive lifecycle state and transitions together. Extract packages only
for actual runtime, distribution, dependency, or ownership boundaries. Prefer explicit control flow and named inputs.

Keep requirements in contracts, design rationale in `.context`, and executable usage in READMEs. Each contract names
an identifiable violation and a concrete check. Product instructions must be self-contained.

Use types, formatting, and linting for mechanical requirements. Retain tests for public behavior and consequential
failure: authorization, lost evidence, duplicate results, repeated paid work, cancellation, or broken package delivery.
Keep paid provider checks outside CI. Passing contract syntax validation does not establish behavioral compliance.

## Checks

Run `pnpm check` from the repository root. Review every new abstraction against a current caller. Review retained
tests for the regression they prevent, and check documented commands from a clean external consumer.
