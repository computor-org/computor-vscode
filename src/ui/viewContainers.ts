import type { TreeScope } from '../services/UiStateService';

/**
 * The activity-bar containers the extension contributes, and which tree view
 * belongs to which.
 *
 * Reopening a workspace always landed on the same container regardless of
 * where the user had been, because the focus step ran a fixed
 * lecturer > tutor > student priority on every activation
 * (computor-org/issues#285). Remembering the container needs a way to name it
 * from a view id, which is what this is.
 */
export interface ViewContainer {
  /** Container id from package.json contributes.viewsContainers. */
  readonly id: string;
  /** The command that focuses it. */
  readonly focusCommand: string;
  /** The role name used in `availableViews`, if it is gated on one. */
  readonly role?: string;
}

const CONTAINERS: Readonly<Record<string, ViewContainer>> = {
  'computor-student': {
    id: 'computor-student',
    focusCommand: 'workbench.view.extension.computor-student',
    role: 'student'
  },
  'computor-student-offline': {
    id: 'computor-student-offline',
    focusCommand: 'workbench.view.extension.computor-student-offline',
    role: 'student.offline'
  },
  'computor-tutor': {
    id: 'computor-tutor',
    focusCommand: 'workbench.view.extension.computor-tutor',
    role: 'tutor'
  },
  'computor-lecturer': {
    id: 'computor-lecturer',
    focusCommand: 'workbench.view.extension.computor-lecturer',
    role: 'lecturer'
  },
  'computor-user-manager': {
    id: 'computor-user-manager',
    focusCommand: 'workbench.view.extension.computor-user-manager',
    role: 'user_manager'
  },
  // Available to every authenticated user, so it is gated on no role.
  'computor-chat': {
    id: 'computor-chat',
    focusCommand: 'workbench.view.extension.computor-chat'
  }
};

/**
 * View id -> container and state scope.
 *
 * Longest-prefix wins, which is why the offline view has to be listed before
 * the student one it shares a prefix with.
 */
const VIEWS: ReadonlyArray<{ viewId: string; container: string; scope: TreeScope }> = [
  { viewId: 'computor.student.offline.view', container: 'computor-student-offline', scope: 'studentOffline' },
  { viewId: 'computor.student.courses', container: 'computor-student', scope: 'student' },
  { viewId: 'computor.tutor.filters', container: 'computor-tutor', scope: 'tutorFilters' },
  { viewId: 'computor.tutor.courses', container: 'computor-tutor', scope: 'tutorContent' },
  { viewId: 'computor.lecturer.courses', container: 'computor-lecturer', scope: 'lecturer' },
  { viewId: 'computor.lecturer.examples', container: 'computor-lecturer', scope: 'lecturerExamples' },
  { viewId: 'computor.lecturer.documents', container: 'computor-lecturer', scope: 'lecturerDocuments' },
  { viewId: 'computor.usermanager.users', container: 'computor-user-manager', scope: 'userManager' },
  { viewId: 'computor.chat.inbox', container: 'computor-chat', scope: 'chat' }
];

export function containerForView(viewId: string): ViewContainer | undefined {
  const entry = VIEWS.find(view => view.viewId === viewId);
  return entry ? CONTAINERS[entry.container] : undefined;
}

export function scopeForView(viewId: string): TreeScope | undefined {
  return VIEWS.find(view => view.viewId === viewId)?.scope;
}

export function containerById(containerId: string): ViewContainer | undefined {
  return CONTAINERS[containerId];
}

/** The views contributed into a container, in contribution order. */
export function viewsForContainer(containerId: string): string[] {
  return VIEWS.filter(view => view.container === containerId).map(view => view.viewId);
}

/**
 * Is this container reachable for the roles the user actually has?
 *
 * A remembered container has to be re-checked: roles change between sessions,
 * and focusing a container whose views are all `when`-gated off would leave
 * the user staring at an empty activity bar entry.
 */
export function isContainerAvailable(container: ViewContainer, availableViews: string[]): boolean {
  return container.role === undefined || availableViews.includes(container.role);
}
