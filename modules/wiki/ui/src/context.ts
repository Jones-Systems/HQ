// What a view may do: read through the injected service, or ask the root to navigate.

import type { PageKey, WikiNamespace, WikiService } from '../../contract/src/index.ts';

export interface ViewCtx {
  readonly service: WikiService;
  readonly openPage: (key: PageKey) => void;
  readonly openSearch: (query: string) => void;
  readonly openTopics: (namespace: WikiNamespace) => void;
  readonly openAmbiguity: (label: string, candidates: readonly PageKey[]) => void;
}
