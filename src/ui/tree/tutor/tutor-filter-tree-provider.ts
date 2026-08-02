import * as vscode from 'vscode';
import type { ComputorApiService } from '../../../services/ComputorApiService';
import type { ComputorSettingsManager } from '../../../settings/ComputorSettingsManager';
import type { TutorSelectionService } from '../../../services/TutorSelectionService';
import { UiStateService } from '../../../services/UiStateService';
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
import { BaseTreeDataProvider } from '../BaseTreeDataProvider';

const NO_ORG_KEY = '__no_org__';
const NO_FAMILY_KEY = '__no_family__';

type FilterTreeItem =
  | TutorOrganizationFilterItem
  | TutorCourseFamilyFilterItem
  | TutorCourseFilterItem
  | TutorGroupFilterItem
  | TutorGroupOptionItem
  | TutorMemberFilterItem;

export class TutorFilterTreeProvider extends BaseTreeDataProvider<FilterTreeItem> {
  private courses: CourseTutorList[] = [];
  private orgLabels = new Map<string, string>();
  private familyLabels = new Map<string, string>();
  private familiesByOrg = new Map<string, string[]>();
  private coursesByFamily = new Map<string, CourseTutorList[]>();
  private hierarchyLoaded = false;
  private hierarchyLoadingPromise?: Promise<void>;

  private groupsCache = new Map<string, CourseGroupList[]>();
  private membersCache = new Map<string, TutorCourseMemberList[]>();

  // In-flight fetches, keyed. These used to be single slots holding "the one
  // fetch we care about", and a second course resolving its children stamped
  // over the first, whose await then returned [] and rendered that course
  // empty. With expansion persisted, two courses resolving at once is the
  // normal case, not an edge one.
  private groupsInFlight = new Map<string, Promise<CourseGroupList[]>>();
  private membersInFlight = new Map<string, Promise<TutorCourseMemberList[]>>();

  private readonly uiState = UiStateService.getInstanceOrUndefined();

  constructor(
    private readonly api: ComputorApiService,
    private readonly selection: TutorSelectionService,
    _settingsManager?: ComputorSettingsManager
  ) {
    super();
  }

  async setNodeExpanded(nodeId: string, expanded: boolean): Promise<void> {
    this.uiState?.setExpanded('tutorFilters', nodeId, expanded);
  }

  private isExpanded(nodeId: string): boolean {
    // Synchronous, so the first getChildren after a reload sees the real
    // state. It used to await a load kicked off in the constructor, which the
    // first render could outrun (computor-org/issues#285).
    return this.uiState?.isExpanded('tutorFilters', nodeId) ?? false;
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

  override refresh(): void {
    this.courses = [];
    this.orgLabels.clear();
    this.familyLabels.clear();
    this.familiesByOrg.clear();
    this.coursesByFamily.clear();
    this.hierarchyLoaded = false;
    this.hierarchyLoadingPromise = undefined;
    this.groupsCache.clear();
    this.membersCache.clear();
    // Drop in-flight fetches too, or a refresh can be answered from a request
    // that was already on its way with the pre-refresh state.
    this.groupsInFlight.clear();
    this.membersInFlight.clear();
    super.refresh();
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

    // Everything under a course node belongs to *that* course, but only the
    // selected one may read — or write — the global selection.
    //
    // Expansion is persisted, so after switching from Python to MATLAB the
    // Python node is still expanded and still resolves its children. It used
    // to read the global group id and then call autoSelectFirstMember
    // unconditionally, which, finding no MATLAB member in the Python roster,
    // re-elected Python's first member and Python's group label. A render path
    // was writing the selection, and the last course to resolve won — so tutor
    // mode snapped back to Group A of the course you had just left
    // (computor-org/issues#287).
    //
    // A non-selected course now renders read-only: its own roster, no group
    // narrowing that isn't its own, and nothing written back.
    const isSelectedCourse = courseId === this.selection.getCurrentCourseId();
    const groupId = isSelectedCourse ? this.selection.getCurrentGroupId() : null;
    const items: FilterTreeItem[] = [];

    await this.fetchGroups(courseId);

    const currentGroupLabel = this.resolveGroupLabel(courseId, groupId);
    items.push(new TutorGroupFilterItem(courseId, currentGroupLabel));

    const members = await this.fetchMembers(courseId, groupId);
    if (members.length === 0) {
      return items;
    }

    if (isSelectedCourse) {
      await this.autoSelectFirstMember(courseId, members);
    }

    const selectedMemberId = isSelectedCourse ? this.selection.getCurrentMemberId() : null;
    for (const member of members) {
      items.push(new TutorMemberFilterItem(member, courseId, member.id === selectedMemberId));
    }

    return items;
  }

  private async getGroupOptions(groupFilterItem: TutorGroupFilterItem): Promise<FilterTreeItem[]> {
    const courseId = groupFilterItem.courseId;
    // Refetch rather than trusting the cache: a refresh clears it, and this
    // node can be re-requested on its own.
    const groups = await this.fetchGroups(courseId);
    // Only the selected course's options reflect the current group; another
    // course's list would otherwise tick a group that isn't in it.
    const currentGroupId = courseId === this.selection.getCurrentCourseId()
      ? this.selection.getCurrentGroupId()
      : null;

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

  /** Display label for a course, for callers that only hold its id. */
  resolveCourseLabel(courseId: string): string | null {
    const course = this.courses.find(c => c.id === courseId);
    if (!course) {
      return null;
    }
    return course.title || course.path || course.id;
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

  /** Course groups, fetched once per course even if two nodes ask at once. */
  private async fetchGroups(courseId: string): Promise<CourseGroupList[]> {
    const cached = this.groupsCache.get(courseId);
    if (cached) {
      return cached;
    }
    return this.dedupe(this.groupsInFlight, courseId, async () => {
      const groups = (await this.api.getTutorCourseGroups(courseId)) || [];
      this.groupsCache.set(courseId, groups);
      return groups;
    });
  }

  private async fetchMembers(courseId: string, groupId: string | null): Promise<TutorCourseMemberList[]> {
    const cacheKey = `${courseId}-${groupId ?? 'all'}`;
    const cached = this.membersCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    return this.dedupe(this.membersInFlight, cacheKey, async () => {
      const isNoGroup = groupId === NO_GROUP_SENTINEL;
      const effectiveGroupId = isNoGroup ? undefined : (groupId || undefined);
      let members: TutorCourseMemberList[] =
        (await this.api.getTutorCourseMembers(courseId, effectiveGroupId)) || [];

      if (isNoGroup) {
        members = members.filter(m => !m.course_group_id);
      }

      members.sort(compareMembersByName);
      this.membersCache.set(cacheKey, members);
      return members;
    });
  }

  /** Share one in-flight request per key instead of racing duplicates. */
  private dedupe<T>(
    inFlight: Map<string, Promise<T>>,
    key: string,
    load: () => Promise<T>
  ): Promise<T> {
    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }
    const started = load();
    inFlight.set(key, started);
    const forget = (): void => {
      inFlight.delete(key);
    };
    started.then(forget, forget);
    return started;
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
          await this.selection.selectMember(existing.id, formatMemberName(existing), existing.course_group_id, groupLabel, existing.user?.email);
        }
        return;
      }
    }
    const first = members[0];
    if (first) {
      const groupLabel = first.course_group_id
        ? this.resolveGroupLabel(courseId, first.course_group_id)
        : null;
      await this.selection.selectMember(first.id, formatMemberName(first), first.course_group_id, groupLabel, first.user?.email);
    }
  }
}
