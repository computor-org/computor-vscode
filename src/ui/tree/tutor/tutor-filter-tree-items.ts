import * as vscode from 'vscode';
import type { TutorCourseMemberList } from '../../../types/generated/courses';

export const NO_GROUP_SENTINEL = '__no_group__';

export function formatMemberName(member: TutorCourseMemberList): string {
  const user = member.user;
  if (user?.given_name && user?.family_name) {
    return `${user.family_name}, ${user.given_name}`;
  }
  return user?.email || user?.username || member.id;
}

export function buildBadgeDescription(member: TutorCourseMemberList): string | undefined {
  const badges: string[] = [];
  if (member.ungraded_submissions_count && member.ungraded_submissions_count > 0) {
    badges.push(`\u{1F4DD} ${member.ungraded_submissions_count}`);
  }
  if (member.unread_message_count && member.unread_message_count > 0) {
    badges.push(`\u{1F514} ${member.unread_message_count}`);
  }
  return badges.length > 0 ? badges.join(' \u00B7 ') : undefined;
}

export function buildMemberTooltip(member: TutorCourseMemberList): string {
  const parts: string[] = [];
  const user = member.user;
  if (user?.given_name || user?.family_name) {
    parts.push(`${user.given_name || ''} ${user.family_name || ''}`.trim());
  }
  if (user?.email) {
    parts.push(`Email: ${user.email}`);
  }
  if (user?.username) {
    parts.push(`Username: ${user.username}`);
  }
  return parts.join('\n');
}

export function compareMembersByName(a: TutorCourseMemberList, b: TutorCourseMemberList): number {
  return formatMemberName(a).localeCompare(formatMemberName(b));
}

export class TutorOrganizationFilterItem extends vscode.TreeItem {
  constructor(
    public readonly organizationId: string,
    label: string,
    expanded: boolean
  ) {
    super(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `tutor-filter-org-${organizationId}`;
    this.contextValue = 'tutorFilterOrganization';
    this.iconPath = new vscode.ThemeIcon('organization');
    this.tooltip = `Organization: ${label}`;
    this.description = 'Organization';
  }
}

export class TutorCourseFamilyFilterItem extends vscode.TreeItem {
  constructor(
    public readonly courseFamilyId: string,
    public readonly organizationId: string,
    label: string,
    expanded: boolean,
    organizationLabel?: string
  ) {
    super(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `tutor-filter-family-${courseFamilyId}`;
    this.contextValue = 'tutorFilterCourseFamily';
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.tooltip = organizationLabel
      ? `Course Family: ${label}\nOrganization: ${organizationLabel}`
      : `Course Family: ${label}`;
    this.description = 'Course Family';
  }
}

export class TutorCourseFilterItem extends vscode.TreeItem {
  constructor(
    public readonly course: { id: string; title?: string | null; path?: string; name?: string },
    public readonly isSelected: boolean,
    expanded: boolean = isSelected,
    parents?: { courseFamilyLabel?: string; organizationLabel?: string }
  ) {
    const label = course.title || course.path || course.name || course.id;
    super(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `tutor-filter-course-${course.id}`;
    this.contextValue = isSelected ? 'tutorFilterCourse.selected' : 'tutorFilterCourse';
    this.iconPath = new vscode.ThemeIcon(isSelected ? 'book' : 'book');
    const tooltipLines: string[] = [`Course: ${label}`];
    if (parents?.courseFamilyLabel) {
      tooltipLines.push(`Course Family: ${parents.courseFamilyLabel}`);
    }
    if (parents?.organizationLabel) {
      tooltipLines.push(`Organization: ${parents.organizationLabel}`);
    }
    this.tooltip = tooltipLines.join('\n');
    if (isSelected) {
      this.description = '(selected)';
    }
  }
}

export class TutorGroupFilterItem extends vscode.TreeItem {
  constructor(
    public readonly courseId: string,
    currentGroupLabel: string
  ) {
    super(`Course Groups: ${currentGroupLabel}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `tutor-filter-groups-${courseId}`;
    this.contextValue = 'tutorGroupFilter';
    this.iconPath = new vscode.ThemeIcon('filter');
  }
}

export class TutorGroupOptionItem extends vscode.TreeItem {
  constructor(
    public readonly courseId: string,
    public readonly groupId: string | null,
    public readonly groupLabel: string,
    public readonly isSelected: boolean,
    public readonly isNoGroup: boolean = false
  ) {
    super(groupLabel, vscode.TreeItemCollapsibleState.None);
    const suffix = isNoGroup ? NO_GROUP_SENTINEL : (groupId ?? 'all');
    this.id = `tutor-filter-group-option-${courseId}-${suffix}`;
    this.contextValue = isSelected ? 'tutorGroupOption.selected' : 'tutorGroupOption';
    this.iconPath = new vscode.ThemeIcon(isSelected ? 'check' : 'circle-outline');
    this.command = {
      command: 'computor.tutor.selectGroup',
      title: 'Select Group',
      arguments: [this]
    };
  }
}

export class TutorMemberFilterItem extends vscode.TreeItem {
  constructor(
    public readonly member: TutorCourseMemberList,
    public readonly courseId: string,
    public readonly isSelected: boolean
  ) {
    super(formatMemberName(member), vscode.TreeItemCollapsibleState.None);
    this.id = `tutor-filter-member-${member.id}`;
    this.contextValue = isSelected ? 'tutorMember.selected' : 'tutorMember';
    this.description = buildBadgeDescription(member);
    this.tooltip = buildMemberTooltip(member);
    this.iconPath = new vscode.ThemeIcon(isSelected ? 'person-filled' : 'person');
    this.command = {
      command: 'computor.tutor.selectMember',
      title: 'Select Member',
      arguments: [this]
    };
  }
}

