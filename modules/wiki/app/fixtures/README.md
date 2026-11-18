# Synthetic Wiki corpus (fixture)

Everything under `corpus/` is invented text for tests of `task.wiki-assembly.001`. It is **synthetic**: no private
corpus, personal data, host address or real project content. The tests turn each directory into a bare Git
repository with one commit (fixed identity and dates, so commit ids are reproducible) and read it only through the
Wiki core's committed-object adapter.

- `corpus/bl/` — namespace `bl`, front-matter topic mode, repository root.
- `corpus/appdev/notes/` — namespace `appdev`, directory topic mode, `rootPrefix: notes`.
  `corpus/appdev/outside/` sits outside the prefix and must never be indexed.

Extra tree entries (a symlink, a submodule-style link, a non-page file) are added by `test/corpus.ts` as Git objects;
they are not files here.
