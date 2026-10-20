/** `@hq/ui`: T2 visual-system tokens, the contrast helper and the RS-3 accessible primitives (task.ui-kit.001). */

// Loading the kit loads the tokens and the class-scoped component styles. The tokens declare only `--hq-*`
// custom properties, `color-scheme` on `:root` / `[data-theme]`, and the RS-2 `[data-hq-content]` well rules.
// `tokens/t0-bridge.css` is deliberately not loaded here: it redefines T0 shell names and is the shell owner's.
import './tokens/hq-tokens.css';
import './components/hq-ui.css';

export * from './components';
export * from './contrast';
export * from './tokens';
