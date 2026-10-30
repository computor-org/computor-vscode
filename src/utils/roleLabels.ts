import { say } from './uiLanguage';

/**
 * Course, organization and course family roles in the reading language. The
 * backend seeds them with English titles only; the ids stay as they are.
 */
export function localizedRoleTitle(roleId: string | null | undefined, title?: string | null): string {
  switch (roleId) {
    case '_student': return say('Student', 'Studierende');
    case '_tutor': return say('Tutor', 'Tutor');
    case '_lecturer': return say('Lecturer', 'Lehrende');
    case '_maintainer': return say('Maintainer', 'Kursverwaltung');
    case '_owner': return say('Owner', 'Besitzer');
    case '_manager': return say('Manager', 'Verwaltung');
    case '_developer': return say('Developer', 'Bearbeitung');
    case '_inactive': return say('Inactive', 'Inaktiv');
    default: return title || roleId || '';
  }
}
