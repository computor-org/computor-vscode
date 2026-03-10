import * as vscode from 'vscode';
import type { TutorCourseMemberList } from '../../../types/generated/courses';

export const NO_GROUP_SENTINEL = '__no_group__';
export const PAGE_SIZE = 5;

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

export function compareMembersByName(a: TutorCourseMemberList, b: TutorCourseMemberList): number {
  return formatMemberName(a).localeCompare(formatMemberName(b));
}

export class TutorCourseFilterItem extends vscode.TreeItem {
  constructor(
    public readonly course: { id: string; title?: string | null; path?: string; name?: string },
    public readonly isSelected: boolean
  ) {
    const label = course.title || course.path || course.name || course.id;
    super(label, isSelected ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `tutor-filter-course-${course.id}`;
    this.contextValue = isSelected ? 'tutorFilterCourse.selected' : 'tutorFilterCourse';
    this.iconPath = new vscode.ThemeIcon(isSelected ? 'book' : 'book');
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
    this.contextValue = 'tutorGroupOption';
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
    this.iconPath = new vscode.ThemeIcon(isSelected ? 'person-filled' : 'person');
    this.command = {
      command: 'computor.tutor.selectMember',
      title: 'Select Member',
      arguments: [this]
    };
  }
}

export class TutorShowMoreItem extends vscode.TreeItem {
  constructor(
    public readonly courseId: string,
    public readonly remainingCount: number
  ) {
    super(`Show more... (${remainingCount} remaining)`, vscode.TreeItemCollapsibleState.None);
    this.id = `tutor-filter-show-more-${courseId}`;
    this.contextValue = 'tutorShowMore';
    this.iconPath = new vscode.ThemeIcon('ellipsis');
    this.command = {
      command: 'computor.tutor.showMoreMembers',
      title: 'Show More Members',
      arguments: [this]
    };
  }
}
