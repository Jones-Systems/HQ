import { bootstrapPreview } from './environment';

declare const __PREVIEW_REVISION__: string;

// The shared shell and module-scope fixtures evaluate only after both storage shims exist.
void bootstrapPreview(window, __PREVIEW_REVISION__, async entry => {
  const { mountPreview } = await import('./mount');
  mountPreview(entry, __PREVIEW_REVISION__);
});
