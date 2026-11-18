import type { ReactNode } from 'react';

// Small line icons local to the board (the shared Work marks live in ../theme/icons). Every one is decorative and
// aria-hidden: the words next to it, or the control's own name, carry the meaning.

function Icon({ children, small = true }: { children: ReactNode; small?: boolean }) {
  return <svg className={small ? 'work-icon work-icon--sm' : 'work-icon'} viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}

export const NotesIcon = () => <Icon><path d="M5 7h14M5 12h14M5 17h9" /></Icon>;
export const ChecklistIcon = () => <Icon><rect x="4" y="4" width="16" height="16" rx="3.5" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></Icon>;
export const LinkIcon = () => <Icon><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></Icon>;
export const MoreIcon = () => <Icon small={false}><path d="M6 12h.01M12 12h.01M18 12h.01" /></Icon>;
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
export const ChevronIcon = () => <Icon><path d="m9 6 6 6-6 6" /></Icon>;
export const InfoIcon = () => <Icon><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></Icon>;
