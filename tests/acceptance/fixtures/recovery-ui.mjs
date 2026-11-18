import assert from 'node:assert/strict';

const socialSaveButton = `document.querySelectorAll('.soc-cmp .soc-savebar-actions button[aria-keyshortcuts="Control+S Meta+S"]')`;

export const recoveryUi = {
  socialLibraryButton: `[...document.querySelectorAll('nav[aria-label="Social"] .sd-nav-label')].filter(label => label.textContent.trim() === 'Library').map(label => label.closest('button')).filter(button => button && !button.hidden && button.getAttribute('aria-hidden') !== 'true')`,
  socialLibraryReady: `!!document.querySelector('.soc-lib-empty, .soc-lib-list')`,
  socialNewDraftScope: `document.querySelector('.soc-lib-empty') ? '.soc-lib-empty' : '.sx-page > header'`,
  socialSaveButton,
  socialSaveBlocked: `(() => { const buttons = [...${socialSaveButton}]; return buttons.length === 1 && buttons[0].disabled; })()`,
  workDetailReady: title => title === undefined
    ? `!!document.querySelector('textarea.work-detail-title')`
    : `document.querySelector('textarea.work-detail-title')?.value === ${JSON.stringify(title)}`,
  returnButton: title => `[...document.querySelectorAll('.hq-return-label')].filter(label => label.textContent.trim() === ${JSON.stringify(`Back to ${title}`)}).map(label => label.closest('button')).filter(button => button && !button.hidden && button.getAttribute('aria-hidden') !== 'true')`,
};

// Poll readiness only. The single click is never inside the polling predicate.
export async function clickRecoveryControl(context, candidates, description) {
  const evaluate = expression => context.cdp().evaluate(expression);
  const select = `const buttons = [...${candidates}];`;
  await context.until(() => evaluate(`(() => { ${select} return buttons.length === 1 && !buttons[0].disabled; })()`), `unique enabled ${description}`);
  assert.equal(await evaluate(`(() => { ${select} if (buttons.length !== 1 || buttons[0].disabled) return false; buttons[0].scrollIntoView({block:'center'}); buttons[0].click(); return true; })()`), true);
}
