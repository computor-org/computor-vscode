import * as vscode from 'vscode';
import type { ComputorApiService } from '../../../services/ComputorApiService';
import type { TutorSelectionService } from '../../../services/TutorSelectionService';
import type { TutorCourseMemberList, CourseGroupList } from '../../../types/generated/courses';
import {
  TutorCourseFilterItem,
  TutorGroupFilterItem,
  TutorGroupOptionItem,
  TutorMemberFilterItem,
  NO_GROUP_SENTINEL,
  formatMemberName,
  compareMembersByName
} from './tutor-filter-tree-items';

type FilterTreeItem =
  | TutorCourseFilterItem
  | TutorGroupFilterItem
  | TutorGroupOptionItem
  | TutorMemberFilterItem;

export class TutorFilterTreeProvider implements vscode.TreeDataProvider<FilterTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FilterTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private courses: Array<{ id: string; title?: string | null; path?: string; name?: string }> = [];
  private groupsCache = new Map<string, CourseGroupList[]>();
  private membersCache = new Map<string, TutorCourseMemberList[]>();

  private currentGroupFetchCourseId?: string | null;
  private currentMemberFetchKey?: { courseId: string | null; groupId: string | null };

  constructor(
    private readonly api: ComputorApiService,
    private readonly selection: TutorSelectionService
  ) {}

  getTreeItem(element: FilterTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FilterTreeItem): Promise<FilterTreeItem[]> {
    if (!element) {
      return this.getRootChildren();
    }
    if (element instanceof TutorCourseFilterItem) {
      return this.getCourseChildren(element);
    }
    if (element instanceof TutorGroupFilterItem) {
      return this.getGroupOptions(element);
    }
    return [];
  }

  refresh(): void {
    this.courses = [];
    this.groupsCache.clear();
    this.membersCache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshFilters(): void {
    this.refresh();
  }

  private async getRootChildren(): Promise<FilterTreeItem[]> {
    if (this.courses.length === 0) {
      this.courses = await this.api.getTutorCourses(false) || [];
    }
    const selectedCourseId = this.selection.getCurrentCourseId();
    return this.courses.map(
      course => new TutorCourseFilterItem(course, course.id === selectedCourseId)
    );
  }

  private async getCourseChildren(courseItem: TutorCourseFilterItem): Promise<FilterTreeItem[]> {
    const courseId = courseItem.course.id;
    const groupId = this.selection.getCurrentGroupId();
    const items: FilterTreeItem[] = [];

    if (!this.groupsCache.has(courseId)) {
      this.currentGroupFetchCourseId = courseId;
      const groups = await this.api.getTutorCourseGroups(courseId) || [];
      if (this.currentGroupFetchCourseId !== courseId) {
        return [];
      }
      this.groupsCache.set(courseId, groups);
    }

    const currentGroupLabel = this.resolveGroupLabel(courseId, groupId);
    items.push(new TutorGroupFilterItem(courseId, currentGroupLabel));

    const members = await this.fetchMembers(courseId, groupId);
    if (members.length === 0) {
      return items;
    }

    await this.autoSelectFirstMember(courseId, members);

    const selectedMemberId = this.selection.getCurrentMemberId();
    for (const member of members) {
      items.push(new TutorMemberFilterItem(member, courseId, member.id === selectedMemberId));
    }

    return items;
  }

  private getGroupOptions(groupFilterItem: TutorGroupFilterItem): FilterTreeItem[] {
    const courseId = groupFilterItem.courseId;
    const groups = this.groupsCache.get(courseId) || [];
    const currentGroupId = this.selection.getCurrentGroupId();

    const options: TutorGroupOptionItem[] = [];

    options.push(new TutorGroupOptionItem(
      courseId, null, 'All Groups', !currentGroupId, false
    ));

    for (const group of groups) {
      const label = group.title || group.id;
      options.push(new TutorGroupOptionItem(
        courseId, group.id, label, currentGroupId === group.id, false
      ));
    }

    options.push(new TutorGroupOptionItem(
      courseId, null, 'No Group', currentGroupId === NO_GROUP_SENTINEL, true
    ));

    return options;
  }

  resolveGroupLabel(courseId: string, groupId: string | null): string {
    if (!groupId) {
      return 'All';
    }
    if (groupId === NO_GROUP_SENTINEL) {
      return 'No Group';
    }
    const groups = this.groupsCache.get(courseId) || [];
    const group = groups.find(g => g.id === groupId);
    return group?.title || groupId;
  }

  private async fetchMembers(courseId: string, groupId: string | null): Promise<TutorCourseMemberList[]> {
    const isNoGroup = groupId === NO_GROUP_SENTINEL;
    const effectiveGroupId = isNoGroup ? undefined : (groupId || undefined);
    const cacheKey = `${courseId}-${groupId ?? 'all'}`;

    if (this.membersCache.has(cacheKey)) {
      return this.membersCache.get(cacheKey)!;
    }

    this.currentMemberFetchKey = { courseId, groupId };
    let members: TutorCourseMemberList[] = await this.api.getTutorCourseMembers(courseId, effectiveGroupId) || [];

    const latest = this.currentMemberFetchKey;
    if (!latest || latest.courseId !== courseId || latest.groupId !== groupId) {
      return [];
    }

    if (isNoGroup) {
      members = members.filter(m => !m.course_group_id);
    }

    members.sort(compareMembersByName);
    this.membersCache.set(cacheKey, members);
    return members;
  }

  private async autoSelectFirstMember(courseId: string, members: TutorCourseMemberList[]): Promise<void> {
    const currentMemberId = this.selection.getCurrentMemberId();
    if (currentMemberId && members.some(m => m.id === currentMemberId)) {
      return;
    }
    const first = members[0];
    if (first) {
      const groupLabel = first.course_group_id
        ? this.resolveGroupLabel(courseId, first.course_group_id)
        : null;
      await this.selection.selectMember(first.id, formatMemberName(first), first.course_group_id, groupLabel);
    }
  }
}
