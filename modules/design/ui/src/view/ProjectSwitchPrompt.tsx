import { useEffect, useRef } from 'react';
import type { ProjectSwitchProposal } from '../project-guard.ts';

export interface ProjectSwitchPromptProps {
  readonly proposal: ProjectSwitchProposal;
  readonly currentName: string;
  /** False when the shell cannot switch projects from Design. */
  readonly available: boolean;
  readonly confirm: (token: number) => void;
  readonly cancel: () => void;
}

const ORIGIN: Readonly<Record<ProjectSwitchProposal['origin'], string>> = {
  palette: 'You chose this from the command palette.',
  reference: 'A reference points into this project.',
  section: 'A Design section asked to open this project.',
};

/** The only route to a project switch. Focus starts on Cancel so Enter alone never switches. */
export function ProjectSwitchPrompt({ proposal, currentName, available, confirm, cancel }: ProjectSwitchPromptProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { cancelRef.current?.focus(); }, [proposal.token]);
  return <div className="hqd-overlay">
    <div className="hqd-prompt" role="alertdialog" aria-modal="true" aria-labelledby="hqd-prompt-title" aria-describedby="hqd-prompt-body"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
        if (event.key === 'Tab') {
          // Two buttons: keep focus inside the dialog.
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
          if (next) { event.preventDefault(); next.focus(); }
        }
      }}>
      <h2 id="hqd-prompt-title">Switch project to {proposal.label}?</h2>
      <p id="hqd-prompt-body">
        {ORIGIN[proposal.origin]} You are in <strong>{currentName}</strong>. Switching changes the project for all of HQ.
        Drafts stay where they are and nothing is sent.
        {!available && ' This window cannot switch projects from Design.'}
      </p>
      <div className="hqd-prompt-actions">
        <button ref={cancelRef} type="button" className="hqd-button" onClick={cancel}>Stay in {currentName}</button>
        <button type="button" className="hqd-button hqd-button-primary" disabled={!available}
          onClick={() => confirm(proposal.token)}>Switch to {proposal.label}</button>
      </div>
    </div>
  </div>;
}
