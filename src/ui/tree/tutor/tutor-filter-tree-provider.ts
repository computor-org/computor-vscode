import * as vscode from 'vscode';
import type { ComputorApiService } from '../../../services/ComputorApiService';
import type { ComputorSettingsManager } from '../../../settings/ComputorSettingsManager';
import type { TutorSelectionService } from '../../../services/TutorSelectionService';
import type { CourseTutorList, TutorCourseMemberList, CourseGroupList } from '../../../types/generated/courses';
import {
  TutorCourseFamilyFilterItem,
  TutorCourseFilterItem,
  TutorGroupFilterItem,
  TutorGroupOptionItem,
  TutorMemberFilterItem,
  TutorOrganizationFilterItem,
  NO_GROUP_SENTINEL,
  formatMemberName,
  compareMembersByName
} from './tutor-filter-tree-items';

const NO_ORG_KEY = '__no_org__';
const NO_FAMILY_KEY = '__no_family__';

type FilterTreeItem =
  | TutorOrganizationFilterItem
  | TutorCourseFamilyFilterItem
  | TutorCourseFilterItem
  | TutorGroupFilterItem
  | TutorGroupOptionItem
  | TutorMemberFilterItem;

export class TutorFilterTreeProvider implements vscode.TreeDataProvider<FilterTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FilterTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private courses: CourseTutorList[] = [];
  private orgLabels = new Map<string, string>();
  private familyLabels = new Map<string, string>();
  private familiesByOrg = new Map<string, string[]>();
  private coursesByFamily = new Map<string, CourseTutorList[]>();
  private hierarchyLoaded = false;
  private hierarchyLoadingPromise?: Promise<void>;

  private groupsCache = new Map<string, CourseGroupList[]>();
  private membersCache = new Map<string, TutorCourseMemberList[]>();

  private currentGroupFetchCourseId?: string | null;
  private currentMemberFetchKey?: { courseId: string | null; groupId: string | null };

  private expandedStates: Record<string, boolean> = {};

  constructor(
    private readonly api: ComputorApiService,
    private readonly selection: TutorSelectionService,
    private readonly settingsManager?: ComputorSettingsManager
  ) {
    void this.loadExpandedStates();
  }

  private async loadExpandedStates(): Promise<void> {
    if (!this.settingsManager) { return; }
    try {
      this.expandedStates = await this.settingsManager.getTutorTreeExpandedStates();
    } catch (error) {
      console.error('[TutorFilterTree] Failed to load expanded states:', error);
      this.expandedStates = {};
    }
  }

  async setNodeExpanded(nodeId: string, expanded: boolean): Promise<void> {
    if (expanded) {
      this.expandedStates[nodeId] = true;
    } else {
      delete this.expandedStates[nodeId];
    }
    if (this.settingsManager) {
      try {
        await this.settingsManager.setTutorNodeExpandedState(nodeId, expanded);
      } catch (error) {
        console.error('[TutorFilterTree] Failed to persist expanded state:', error);
      }
    }
  }

  private isExpanded(nodeId: string): boolean {
    return this.expandedStates[nodeId] === true;
  }

  getTreeItem(element: FilterTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FilterTreeItem): Promise<FilterTreeItem[]> {
    if (!element) {
      return this.getRootChildren();
    }
    if (element instanceof TutorOrganizationFilterItem) {
      return this.getOrganizationChildren(element);
    }
    if (element instanceof TutorCourseFamilyFilterItem) {
      return this.getCourseFamilyChildren(element);
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
    this.orgLabels.clear();
    this.familyLabels.clear();
    this.familiesByOrg.clear();
    this.coursesByFamily.clear();
    this.hierarchyLoaded = false;
    this.hierarchyLoadingPromise = undefined;
    this.groupsCache.clear();
    this.membersCache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshFilters(): void {
    this.refresh();
  }

  private async ensureHierarchyLoaded(): Promise<void> {
    if (this.hierarchyLoaded) { return; }
    if (this.hierarchyLoadingPromise) {
      await this.hierarchyLoadingPromise;
      return;
    }
    this.hierarchyLoadingPromise = this.loadHierarchy().finally(() => {
      this.hierarchyLoadingPromise = undefined;
    });
    await this.hierarchyLoadingPromise;
  }

  private async loadHierarchy(): Promise<void> {
    const courses = (await this.api.getTutorCourses(false)) || [];
    this.courses = courses as CourseTutorList[];

    const orgIds = new Set<string>();
    const familyIds = new Set<string>();
    for (const course of this.courses) {
      if (course.organization_id) { orgIds.add(course.organization_id); }
      if (course.course_family_id) { familyIds.add(course.course_family_id); }
    }

    const [orgs, families] = await Promise.all([
      Promise.all([...orgIds].map(id => this.api.getOrganization(id).catch(() => undefined))),
      Promise.all([...familyIds].map(id => this.api.getCourseFamily(id).catch(() => undefined)))
    ]);

    for (const org of orgs) {
      if (org && typeof org === 'object' && 'id' in org && typeof (org as any).id === 'string') {
        const label = (org as any).title || (org as any).path || (org as any).id;
        this.orgLabels.set((org as any).id, label);
      }
    }
    for (const family of families) {
      if (family && typeof family === 'object' && 'id' in family && typeof (family as any).id === 'string') {
        const label = (family as any).title || (family as any).path || (family as any).id;
        this.familyLabels.set((family as any).id, label);
      }
    }

    this.familiesByOrg.clear();
    this.coursesByFamily.clear();
    for (const course of this.courses) {
      const orgKey = course.organization_id || NO_ORG_KEY;
      const familyKey = course.course_family_id || NO_FAMILY_KEY;
      const familyList = this.familiesByOrg.get(orgKey) ?? [];
      if (!familyList.includes(familyKey)) {
        familyList.push(familyKey);
        this.familiesByOrg.set(orgKey, familyList);
      }
      const courseList = this.coursesByFamily.get(familyKey) ?? [];
      courseList.push(course);
      this.coursesByFamily.set(familyKey, courseList);
    }

    this.hierarchyLoaded = true;
  }

  private async getRootChildren(): Promise<FilterTreeItem[]> {
    await this.ensureHierarchyLoaded();
    const selectedCourseId = this.selection.getCurrentCourseId();
    const selectedOrgId = this.findCourseOrgId(selectedCourseId);

    const orgKeys = Array.from(this.familiesByOrg.keys()).sort((a, b) => {
      const aLabel = this.resolveOrgLabel(a);
      const bLabel = this.resolveOrgLabel(b);
      return aLabel.localeCompare(bLabel);
    });

    return orgKeys.map(orgKey => new TutorOrganizationFilterItem(
      orgKey,
      this.resolveOrgLabel(orgKey),
      orgKey === selectedOrgId || this.isExpanded(`tutor-filter-org-${orgKey}`)
    ));
  }

  private async getOrganizationChildren(orgItem: TutorOrganizationFilterItem): Promise<FilterTreeItem[]> {
    await this.ensureHierarchyLoaded();
    const familyKeys = (this.familiesByOrg.get(orgItem.organizationId) ?? []).slice().sort((a, b) => {
      const aLabel = this.resolveFamilyLabel(a);
      const bLabel = this.resolveFamilyLabel(b);
      return aLabel.localeCompare(bLabel);
    });
    const selectedFamilyId = this.findCourseFamilyId(this.selection.getCurrentCourseId());
    const orgLabel = this.resolveOrgLabel(orgItem.organizationId);
    return familyKeys.map(familyKey => new TutorCourseFamilyFilterItem(
      familyKey,
      orgItem.organizationId,
      this.resolveFamilyLabel(familyKey),
      familyKey === selectedFamilyId || this.isExpanded(`tutor-filter-family-${familyKey}`),
      orgLabel
    ));
  }

  private async getCourseFamilyChildren(familyItem: TutorCourseFamilyFilterItem): Promise<FilterTreeItem[]> {
    await this.ensureHierarchyLoaded();
    const courses = (this.coursesByFamily.get(familyItem.courseFamilyId) ?? []).slice().sort((a, b) => {
      const aLabel = a.title || a.path || a.id;
      const bLabel = b.title || b.path || b.id;
      return aLabel.localeCompare(bLabel);
    });
    const selectedCourseId = this.selection.getCurrentCourseId();
    const courseFamilyLabel = this.resolveFamilyLabel(familyItem.courseFamilyId);
    const organizationLabel = this.resolveOrgLabel(familyItem.organizationId);
    return courses.map(course => {
      const isSelected = course.id === selectedCourseId;
      const expanded = isSelected || this.isExpanded(`tutor-filter-course-${course.id}`);
      return new TutorCourseFilterItem(course, isSelected, expanded, { courseFamilyLabel, organizationLabel });
    });
  }

  private resolveOrgLabel(orgKey: string): string {
    if (orgKey === NO_ORG_KEY) { return '(No Organization)'; }
    return this.orgLabels.get(orgKey) || orgKey;
  }

  private resolveFamilyLabel(familyKey: string): string {
    if (familyKey === NO_FAMILY_KEY) { return '(No Course Family)'; }
    return this.familyLabels.get(familyKey) || familyKey;
  }

  private findCourseOrgId(courseId: string | null | undefined): string | undefined {
    if (!courseId) { return undefined; }
    const course = this.courses.find(c => c.id === courseId);
    if (!course) { return undefined; }
    return course.organization_id || NO_ORG_KEY;
  }

  private findCourseFamilyId(courseId: string | null | undefined): string | undefined {
    if (!courseId) { return undefined; }
    const course = this.courses.find(c => c.id === courseId);
    if (!course) { return undefined; }
    return course.course_family_id || NO_FAMILY_KEY;
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
    if (currentMemberId) {
      const existing = members.find(m => m.id === currentMemberId);
      if (existing) {
        if (!this.selection.getMemberEmail() && existing.user?.email) {
          const groupLabel = existing.course_group_id
            ? this.resolveGroupLabel(courseId, existing.course_group_id)
            : null;
          await this.selection.selectMember(existing.id, formatMemberName(existing), existing.course_group_id, groupLabel, existing.user?.email, existing.user?.username);
        }
        return;
      }
    }
    const first = members[0];
    if (first) {
      const groupLabel = first.course_group_id
        ? this.resolveGroupLabel(courseId, first.course_group_id)
        : null;
      await this.selection.selectMember(first.id, formatMemberName(first), first.course_group_id, groupLabel, first.user?.email, first.user?.username);
    }
  }
}
