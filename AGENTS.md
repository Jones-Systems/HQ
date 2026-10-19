# HQ working agreements

HQ is one Electron application with Design, Social and Work domains. M Jones owns product decisions. Each implementation lane has an explicitly assigned scope and isolated non-main worktree. Its agent is sole Git owner there. Preserve unrelated changes; never reset/clean or rewrite history. No sudo, deployment, signing, credential access or private-data access without exact separate authorization.

Read docs/engineering-specs/hq-bootstrap.md and the assigned campaign plan before work. Root configuration, lockfiles, shared contracts and desktop packaging have one coordinating owner. Module lanes edit only their assigned directory and lane-local tests/docs. Propose shared changes through the coordination issue; do not edit other lanes. Work card movement, reference navigation and domain switches never launch work.

This is a public repository. Do not copy private source, personal data, internal host addresses, session history or credentials into it. Existing private implementations may inform bounded interface research; importing actual files requires a selected-file licensing and publication decision.

Use meaningful focused tests and inspect final diffs. Source completion, checked behavior, source integration and installed app are distinct. No automated PR reviewer bots. Publication of an assigned candidate is authorized; merge is held for integration-owner agreement. Record exact commits and check results. Report unknown dispatch effects without retrying them blindly.
