import type { ComponentSource, VariantSet } from '../src/contract.ts';
import { SYNTHETIC_BUTTON, SYNTHETIC_BUTTON_VARIANTS, SYNTHETIC_CARD, SYNTHETIC_CARD_VARIANTS, SYNTHETIC_MOTION, SYNTHETIC_SYSTEM } from '../src/fixtures.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import { ComponentLibrary } from '../src/workspace/library.ts';
import { createMemoryStorage } from '../src/workspace/fakes.ts';
import type { MemoryStorage } from '../src/workspace/fakes.ts';

export interface Workspace {
  readonly storage: MemoryStorage;
  readonly library: ComponentLibrary;
  readonly button: ComponentSource;
  readonly buttonVariants: VariantSet;
  readonly card: ComponentSource;
}

/** Seeds a FAKE in-memory workspace with the synthetic fixtures. */
export async function seededWorkspace(): Promise<Workspace> {
  const storage = createMemoryStorage();
  const library = new ComponentLibrary(storage, webCryptoDigest);
  const button = await library.saveSource(SYNTHETIC_BUTTON);
  const buttonVariants = await library.saveVariants(button, { componentId: button.componentId, sourceRevision: button.revision, variants: SYNTHETIC_BUTTON_VARIANTS });
  const card = await library.saveSource(SYNTHETIC_CARD);
  await library.saveVariants(card, { componentId: card.componentId, sourceRevision: card.revision, variants: SYNTHETIC_CARD_VARIANTS });
  await library.saveDesignSystem(SYNTHETIC_SYSTEM);
  await library.saveMotionStudy(SYNTHETIC_MOTION);
  return { storage, library, button, buttonVariants, card };
}
