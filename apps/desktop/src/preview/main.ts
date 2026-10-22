import { bootstrapPreview } from './environment';

declare const __PREVIEW_REVISION__: string;

// App and module-scope fixtures must only evaluate after both storage shims exist.
void bootstrapPreview(window, __PREVIEW_REVISION__, async entry => {
  const { mountPreview } = await import('./mount');
  mountPreview(entry, __PREVIEW_REVISION__);
});
