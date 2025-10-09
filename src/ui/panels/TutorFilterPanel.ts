import * as vscode from 'vscode';
import { ComputorApiService } from '../../services/ComputorApiService';
import { TutorSelectionService } from '../../services/TutorSelectionService';

export class TutorFilterPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'computor.tutor.filters';
  private _view?: vscode.WebviewView;
  private currentGroupFetchCourseId?: string | null;
  private currentMemberFetchKey?: { courseId: string | null; groupId: string | null };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: ComputorApiService,
    private readonly selection: TutorSelectionService
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refreshFilters();
      }
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'course-select':
          await this.selection.selectCourse(message.id || null, message.label || null);
          await this.postCourseGroups();
          await this.postCourseMembers();
          break;
        case 'course-group-select':
          await this.selection.selectGroup(message.id || null, message.label || null);
          await this.postCourseMembers();
          break;
        case 'course-member-select':
          await this.selection.selectMember(message.id || null, message.label || null);
          break;
      }
    });

    this.updateHtml();
    // Initial data: load groups and members based on the fixed course selection
    this.refreshFilters();
  }

  private async updateHtml(): Promise<void> {
    if (!this._view) return;
    const nonce = Math.random().toString(36).slice(2);
    const webview = this._view.webview;
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'tutor-filters.css'));
    this._view.webview.html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link href="${stylesUri}" rel="stylesheet" />
      </head>
      <body>
        <section class="filter-fields" data-state="loading">
          <label class="filter-field" for="course">
            <span class="filter-field__label">Course</span>
            <div class="filter-field__control">
              <select id="course" aria-label="Course" disabled>
                <option value="" disabled selected>Loading courses…</option>
              </select>
            </div>
            <span class="filter-field__hint">Select the course to tutor.</span>
          </label>
          <label class="filter-field" for="group">
            <span class="filter-field__label">Group</span>
            <div class="filter-field__control">
              <select id="group" aria-label="Group" disabled>
                <option value="" disabled selected>Loading…</option>
              </select>
            </div>
            <span class="filter-field__hint">Optional — narrow to a single group.</span>
          </label>
          <label class="filter-field" for="member">
            <span class="filter-field__label">Member</span>
            <div class="filter-field__control">
              <select id="member" aria-label="Member" disabled>
                <option value="" disabled selected>Waiting for members…</option>
              </select>
            </div>
            <span class="filter-field__hint">Choose who to inspect in the tree.</span>
          </label>
        </section>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const courseSel = document.getElementById('course');
          const groupSel = document.getElementById('group');
          const memberSel = document.getElementById('member');
          const fieldsWrapper = document.querySelector('.filter-fields');

          const state = {
            courses: false,
            groups: false,
            members: false
          };

          const toStringOrEmpty = (value) => (value == null ? '' : String(value));
          const escapeHtml = (value) => toStringOrEmpty(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
          const getGroupLabel = (group) => group.title || group.name || group.id;
          const getMemberLabel = (member) => {
            const user = member?.user;
            if (user?.given_name && user?.family_name) {
              return user.given_name + ' ' + user.family_name;
            }
            return (user?.full_name) || (user?.username) || member.id;
          };

          const updatePanelState = () => {
            if (!fieldsWrapper) return;
            const loading = !state.members;
            fieldsWrapper.dataset.state = loading ? 'loading' : 'ready';
          };

          const buildOptions = (items, selectedId, labelSelector) => items.map((item) => {
            const value = toStringOrEmpty(item.id);
            const label = escapeHtml(labelSelector(item));
            const selected = selectedId === value ? ' selected' : '';
            return '<option value="' + escapeHtml(value) + '"' + selected + '>' + label + '</option>';
          });

          const resetGroups = (placeholder) => {
            groupSel.disabled = true;
            groupSel.innerHTML = '<option value="" disabled selected>' + escapeHtml(placeholder) + '</option>';
            state.groups = false;
          };

          const resetMembers = (placeholder) => {
            memberSel.disabled = true;
            memberSel.innerHTML = '<option value="" disabled selected>' + escapeHtml(placeholder) + '</option>';
            state.members = false;
            updatePanelState();
          };

          window.addEventListener('message', (event) => {
            const { command, data = [], selected, disabled } = event.data || {};
            const selectedId = toStringOrEmpty(selected);
            if (command === 'courses') {
              state.courses = true;
              courseSel.innerHTML = '';
              if (!data || data.length === 0) {
                courseSel.innerHTML = '<option value="" disabled selected>No courses available</option>';
                courseSel.disabled = true;
                resetGroups('No course selected');
                resetMembers('No course selected');
              } else {
                courseSel.innerHTML = '<option value="">All courses</option>';
                for (const course of data) {
                  const opt = document.createElement('option');
                  opt.value = course.id || '';
                  opt.textContent = course.title || course.path || course.name || course.id || 'Untitled';
                  if (selectedId && selectedId === course.id) {
                    opt.selected = true;
                  }
                  courseSel.appendChild(opt);
                }
                courseSel.disabled = false;
              }
              updatePanelState();
            } else if (command === 'groups') {
              state.groups = true;
              if (disabled) {
                groupSel.innerHTML = '<option value="" disabled selected>Course unavailable</option>';
                groupSel.disabled = true;
              } else {
                const options = ['<option value=""' + (selectedId ? '' : ' selected') + '>All groups</option>'];
                options.push(...buildOptions(data ?? [], selectedId, getGroupLabel));
                groupSel.innerHTML = options.join('');
                groupSel.disabled = false;
                if (selectedId) {
                  groupSel.value = selectedId;
                }
              }
            } else if (command === 'members') {
              state.members = true;
              if (disabled) {
                memberSel.innerHTML = '<option value="" disabled selected>Course unavailable</option>';
                memberSel.disabled = true;
              } else {
                const items = data ?? [];
                if (!items.length) {
                  memberSel.innerHTML = '<option value="" disabled selected>No members found</option>';
                  memberSel.disabled = true;
                } else {
                  memberSel.innerHTML = buildOptions(items, selectedId, getMemberLabel).join('');
                  memberSel.disabled = false;
                  if (selectedId) {
                    memberSel.value = selectedId;
                  } else {
                    memberSel.selectedIndex = 0;
                  }
                }
              }
              updatePanelState();
            }
          });

          courseSel.addEventListener('change', () => {
            if (courseSel.disabled) {
              return;
            }
            const label = courseSel.options[courseSel.selectedIndex]?.text || null;
            resetGroups('Loading…');
            resetMembers('Waiting for groups…');
            vscode.postMessage({ command: 'course-select', id: courseSel.value || null, label });
          });

          groupSel.addEventListener('change', () => {
            if (groupSel.disabled) {
              return;
            }
            const label = groupSel.options[groupSel.selectedIndex]?.text || null;
            resetMembers('Loading…');
            vscode.postMessage({ command: 'course-group-select', id: groupSel.value || null, label });
          });

          memberSel.addEventListener('change', () => {
            if (memberSel.disabled) {
              return;
            }
            const label = memberSel.options[memberSel.selectedIndex]?.text || null;
            vscode.postMessage({ command: 'course-member-select', id: memberSel.value || null, label });
          });
        </script>
      </body>
      </html>
    `;
  }

  public refreshFilters(): void {
    void this.postCourses();
    void this.postCourseGroups();
    void this.postCourseMembers();
  }

  private async postCourses(): Promise<void> {
    const courses = await this.api.getTutorCourses(false) || [];
    this._view?.webview.postMessage({
      command: 'courses',
      data: courses,
      selected: this.selection.getCurrentCourseId()
    });
  }

  private async postCourseGroups(): Promise<void> {
    const courseId = this.selection.getCurrentCourseId();
    this.currentGroupFetchCourseId = courseId;

    let groups: any[] = [];
    if (courseId) {
      groups = await (this.api as any).getTutorCourseGroups?.(courseId) || [];
    }

    if (this.currentGroupFetchCourseId !== courseId || courseId !== this.selection.getCurrentCourseId()) {
      return;
    }

    this._view?.webview.postMessage({
      command: 'groups',
      data: groups,
      selected: this.selection.getCurrentGroupId(),
      disabled: !courseId
    });
  }

  private async postCourseMembers(): Promise<void> {
    const courseId = this.selection.getCurrentCourseId();
    const groupId = this.selection.getCurrentGroupId();
    this.currentMemberFetchKey = { courseId, groupId };

    let members: any[] = [];
    if (courseId) {
      members = await this.api.getTutorCourseMembers(courseId, groupId || undefined) || [];
    }

    const latest = this.currentMemberFetchKey;
    if (!latest || latest.courseId !== courseId || latest.groupId !== groupId) {
      return;
    }
    if (courseId !== this.selection.getCurrentCourseId() || groupId !== this.selection.getCurrentGroupId()) {
      return;
    }

    let selected = this.selection.getCurrentMemberId();
    if ((!selected || selected === '') && members && members.length > 0) {
      const first = members[0];
      let label = first.id;
      if (first.user) {
        if (first.user.given_name && first.user.family_name) {
          label = first.user.given_name + ' ' + first.user.family_name;
        } else {
          label = first.user.full_name || first.user.username || first.id;
        }
      }
      await this.selection.selectMember(first.id, label);
      selected = first.id;
    }
    this._view?.webview.postMessage({
      command: 'members',
      data: members,
      selected,
      disabled: !courseId
    });
  }
}