import { expect } from 'chai';

import { ChatInboxTreeProvider } from '../../../src/ui/tree/chat/ChatInboxTreeProvider';
import {
  ChatCourseItem,
  ChatCourseSectionItem,
  ChatScopeItem,
  ChatTopAnnouncementsItem,
  formatCountsDescription
} from '../../../src/ui/tree/chat/ChatInboxTreeItems';
import type { MessageList } from '../../../src/types/generated';
import type { ComputorApiService } from '../../../src/services/ComputorApiService';
import type { MessagesWebviewProvider } from '../../../src/ui/webviews/MessagesWebviewProvider';

/**
 * The course-first inbox (issue #322): one node per course with
 * Announcements/Assignments beneath it, counts that mean messages and unread
 * messages at every level, "no messages" instead of a dead "click to load",
 * and a persisted-state migration from the scope-first v1 shape.
 */

interface ProviderInternals {
  buildRootItems: (grouped: Map<string, Map<string, MessageList[]>>) => vscode.TreeItem[];
  buildCourseSections: (course: ChatCourseItem) => ChatCourseSectionItem[];
  courseScopeStates: Map<string, Map<string, { messages: MessageList[]; fetched: number; total: number }>>;
  scopeFetchStates: Map<string, { messages: MessageList[]; fetched: number; total: number }>;
  counts?: Map<string, { total: number; unread: number }>;
  countsTotals?: { total: number; unread: number };
  unreadOnly: boolean;
  currentUserId?: string;
  muteTopAnnouncements: boolean;
  pendingMuteAllCourses: boolean;
  mutedCourses: Set<string>;
  expandedCourses: Set<string>;
  expandedSections: Set<string>;
  labels: Record<string, unknown>;
}
import type * as vscode from 'vscode';

const ALL_V1_SCOPES = [
  'user', 'course_member', 'submission_group', 'course_group', 'course_content',
  'course', 'course_family', 'organization', 'global'
];

function makeProvider(storedState?: unknown): {
  provider: ChatInboxTreeProvider;
  internals: ProviderInternals;
  persisted: unknown[];
} {
  const persisted: unknown[] = [];
  const context = {
    globalState: {
      get: () => storedState,
      update: async (_key: string, value: unknown) => { persisted.push(value); }
    }
  } as unknown as import('vscode').ExtensionContext;

  const provider = new ChatInboxTreeProvider(
    context,
    {} as ComputorApiService,
    {} as MessagesWebviewProvider
  );
  const internals = provider as unknown as ProviderInternals;
  internals.labels = {
    courseLabel: (id: string) => (id === 'c-1' ? 'Programming in MATLAB' : undefined),
    label: () => ({ title: 'x' })
  };
  return { provider, internals, persisted };
}

/** Seed the per-course state maps for one course, nothing fetched yet. */
function seedCourse(internals: ProviderInternals, courseId: string): void {
  for (const scope of ['submission_group', 'course', 'course_group', 'course_content']) {
    if (!internals.courseScopeStates.has(scope)) {
      internals.courseScopeStates.set(scope, new Map());
    }
    internals.courseScopeStates.get(scope)!.set(courseId, { messages: [], fetched: 0, total: -1 });
  }
}

describe('formatCountsDescription', () => {
  it('renders unread and total when there are unread messages', () => {
    expect(formatCountsDescription({ total: 27, unread: 3 })).to.equal('3 unread · 27');
  });
  it('renders just the total when everything is read', () => {
    expect(formatCountsDescription({ total: 4, unread: 0 })).to.equal('4');
  });
  it('says "no messages" for a known-empty cell', () => {
    expect(formatCountsDescription({ total: 0, unread: 0 })).to.equal('no messages');
  });
  it('stays silent when the numbers are unknown', () => {
    expect(formatCountsDescription(undefined)).to.equal('');
  });
});

describe('ChatInboxTreeProvider — course-first root', () => {
  it('renders Announcements first, then one node per course, with real counts', () => {
    const { internals } = makeProvider();
    seedCourse(internals, 'c-1');
    internals.counts = new Map([
      ['global::', { total: 3, unread: 1 }],
      ['course::c-1', { total: 5, unread: 1 }],
      ['submission_group::c-1', { total: 19, unread: 2 }]
    ]);
    internals.countsTotals = { total: 27, unread: 4 };

    const items = internals.buildRootItems(new Map());

    expect(items[0]).to.be.instanceOf(ChatTopAnnouncementsItem);
    expect((items[0] as vscode.TreeItem).description).to.equal('1 unread · 3');
    expect(items[1]).to.be.instanceOf(ChatCourseItem);
    expect((items[1] as ChatCourseItem).courseId).to.equal('c-1');
    // Course counts are messages across all four course scopes, not child
    // node counts (the old tree showed the number of courses here).
    expect((items[1] as vscode.TreeItem).description).to.equal('3 unread · 24');
  });

  it('uses the server total for the badge so unfetched sections count too', () => {
    const { provider, internals } = makeProvider();
    seedCourse(internals, 'c-1');
    internals.counts = new Map([['submission_group::c-1', { total: 10, unread: 7 }]]);
    internals.countsTotals = { total: 10, unread: 7 };
    internals.buildRootItems(new Map());
    expect(provider.getTotalUnread()).to.equal(7);
  });

  it('shows no numbers when counts are unavailable and nothing was fetched', () => {
    const { internals } = makeProvider();
    seedCourse(internals, 'c-1');
    const items = internals.buildRootItems(new Map());
    const course = items.find(i => i instanceof ChatCourseItem) as vscode.TreeItem;
    expect(course.description).to.equal('');
  });

  it('hides DM sections that hold no messages', () => {
    const { internals } = makeProvider();
    seedCourse(internals, 'c-1');
    const items = internals.buildRootItems(new Map());
    expect(items.some(i => i instanceof ChatScopeItem)).to.equal(false);
  });

  it('shows a DM section when it has messages', () => {
    const { internals } = makeProvider();
    seedCourse(internals, 'c-1');
    const dm = {
      id: 'm-dm', content: 'hi', level: 0, author_id: 'other',
      user_id: 'u-1', scope: 'user', kind: 'conversation', is_read: true
    } as unknown as MessageList;
    const grouped = new Map([['user', new Map([['u-1', [dm]]])]]);
    const items = internals.buildRootItems(grouped);
    expect(items.some(i => i instanceof ChatScopeItem)).to.equal(true);
  });
});

describe('ChatInboxTreeProvider — course sections', () => {
  const course = () => new ChatCourseItem('c-1', 'Programming in MATLAB', 0, undefined, false, false);

  it('splits a course into Announcements and Assignments with own counts', () => {
    const { internals } = makeProvider();
    seedCourse(internals, 'c-1');
    internals.counts = new Map([
      ['course::c-1', { total: 5, unread: 1 }],
      ['course_group::c-1', { total: 3, unread: 0 }],
      ['submission_group::c-1', { total: 19, unread: 2 }]
    ]);

    const sections = internals.buildCourseSections(course());
    expect(sections.map(s => s.kind)).to.deep.equal(['announcements', 'assignments']);
    expect(sections[0]!.description).to.equal('1 unread · 8');
    expect(sections[1]!.description).to.equal('2 unread · 19');
  });

  it('renders a known-empty section as a leaf saying "no messages"', () => {
    const { internals } = makeProvider();
    seedCourse(internals, 'c-1');
    internals.counts = new Map(); // counts API answered: nothing anywhere

    const sections = internals.buildCourseSections(course());
    for (const section of sections) {
      expect(section.collapsibleState).to.equal(0 /* None */);
      expect(section.description).to.equal('no messages');
      // Still openable — writing the first message is what empty is for.
      expect(section.command?.command).to.equal('computor.chat.openMessages');
    }
  });

  it('keeps an unknown section expandable instead of lying "click to load"', () => {
    const { internals } = makeProvider();
    seedCourse(internals, 'c-1');
    // No counts API, nothing fetched: the numbers are unknown.
    const sections = internals.buildCourseSections(course());
    for (const section of sections) {
      expect(section.collapsibleState).to.not.equal(0);
      expect(section.description).to.equal('');
    }
  });
});

describe('ChatInboxTreeProvider — persisted state migration', () => {
  it('passes v2 state straight through', () => {
    const { internals } = makeProvider({
      version: 2,
      unreadOnly: true,
      expandedCourses: ['c-9'],
      expandedSections: ['top', 'assignments::c-9'],
      mutedCourses: ['c-9'],
      muteTopAnnouncements: true
    });
    expect(internals.unreadOnly).to.equal(true);
    expect(internals.expandedCourses.has('c-9')).to.equal(true);
    expect(internals.expandedSections.has('assignments::c-9')).to.equal(true);
    expect(internals.mutedCourses.has('c-9')).to.equal(true);
    expect(internals.muteTopAnnouncements).to.equal(true);
  });

  it('migrates a fully muted v1 state to mute-everything', () => {
    const { internals, persisted } = makeProvider({
      expandedScopes: ['course'],
      unreadOnly: true,
      mutedScopes: ALL_V1_SCOPES
    });
    expect(internals.unreadOnly).to.equal(true);
    expect(internals.muteTopAnnouncements).to.equal(true);
    // Course ids aren't known at load time; the mute-all is finished on the
    // first reload.
    expect(internals.pendingMuteAllCourses).to.equal(true);
    // Written back immediately in the v2 shape.
    expect((persisted[0] as { version?: number })?.version).to.equal(2);
  });

  it('maps muted announcement scopes onto the top mute and drops the rest', () => {
    const { internals } = makeProvider({
      expandedScopes: [],
      unreadOnly: false,
      mutedScopes: ['global', 'organization', 'course_family', 'submission_group']
    });
    expect(internals.muteTopAnnouncements).to.equal(true);
    expect(internals.pendingMuteAllCourses).to.equal(false);
    expect(internals.mutedCourses.size).to.equal(0);
  });

  it('drops v1 expansion state — the tree shape changed', () => {
    const { internals } = makeProvider({
      expandedScopes: ['course', 'submission_group'],
      unreadOnly: false,
      expandedCourseGroups: ['submission_group::c-1']
    });
    expect(internals.expandedCourses.size).to.equal(0);
    expect(internals.expandedSections.size).to.equal(0);
  });
});
