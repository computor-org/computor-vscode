import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseContentTypeGet, CourseList, CourseContentKindList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { SHARED_STYLES } from './shared/webviewStyles';
import { escapeHtml, infoRowText, infoRowCode, infoRow, section, badge, colorSwatch, formGroup, textInput, textareaInput, pageShell } from './shared/webviewHelpers';

export class CourseContentTypeWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseContentTypeView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    contentType: CourseContentTypeGet;
    course: CourseList;
    contentKind?: CourseContentKindList;
  }): Promise<string> {
    if (!data?.contentType) {
      return this.getBaseHtml('Content Type', '<p>No content type data available</p>');
    }

    const { contentType, course, contentKind } = data;
    const nonce = this.getNonce();

    let kind = contentKind;
    if (!kind) {
      try {
        const kinds = await this.apiService.getCourseContentKinds();
        kind = kinds.find(k => k.id === contentType.course_content_kind_id);
      } catch (error) {
        console.error('Failed to get content kind:', error);
      }
    }

    const color = contentType.color || '#888888';

    const headerHtml = `
      <h1>${colorSwatch(color)} ${escapeHtml(contentType.title || contentType.slug)}</h1>
      <p>Content Type in ${escapeHtml(course?.title || course?.path)}</p>`;

    const kindBadges = kind ? `
      ${infoRow('Submittable', kind.submittable ? badge('Yes', 'success') : badge('No', 'muted'))}
      ${infoRow('Can Have Children', kind.has_descendants ? badge('Yes', 'info') : badge('No', 'muted'))}
      ${infoRow('Can Have Parent', kind.has_ascendants ? badge('Yes', 'info') : badge('No', 'muted'))}
    ` : '';

    const infoHtml = section('Information', `
      ${infoRowCode('ID', contentType.id)}
      ${infoRowCode('Slug', contentType.slug)}
      ${infoRow('Color', `${colorSwatch(color)} <span class="code">${escapeHtml(color)}</span>`)}
      ${infoRowText('Content Kind', kind?.title || contentType.course_content_kind_id)}
      ${infoRowText('Description', contentType.description)}
      ${kindBadges}
    `);

    const editHtml = section('Edit Content Type', `
      <form id="editForm">
        ${formGroup('Title', textInput('title', contentType.title, { placeholder: 'Content type title' }))}
        ${formGroup('Slug', textInput('slug', contentType.slug, { required: true, pattern: '[a-z0-9_-]+', placeholder: 'content-type-slug' }))}
        ${formGroup('Color', `
          <div class="color-input-row">
            <input type="color" id="colorPicker" value="${escapeHtml(color)}">
            <input type="text" id="colorText" name="color" value="${escapeHtml(color)}" placeholder="#000000">
          </div>
        `)}
        ${formGroup('Description', textareaInput('description', contentType.description, { placeholder: 'Content type description' }))}
        <div class="actions">
          <button type="submit">Save Changes</button>
          <button type="button" class="btn-secondary" onclick="refreshData()">Refresh</button>
        </div>
      </form>
    `);

    const scriptHtml = `
      var typeId = ${JSON.stringify(contentType.id)};
      var colorPicker = document.getElementById('colorPicker');
      var colorText = document.getElementById('colorText');

      colorPicker.addEventListener('input', function() { colorText.value = colorPicker.value; });
      colorText.addEventListener('input', function() {
        if (/^#[0-9a-fA-F]{6}$/.test(colorText.value)) { colorPicker.value = colorText.value; }
      });

      document.getElementById('editForm').addEventListener('submit', function(e) {
        e.preventDefault();
        vscode.postMessage({
          command: 'updateContentType',
          data: {
            typeId: typeId,
            updates: {
              title: document.getElementById('title').value,
              slug: document.getElementById('slug').value,
              color: colorText.value,
              description: document.getElementById('description').value
            }
          }
        });
      });

      function refreshData() {
        vscode.postMessage({ command: 'refresh', data: { typeId: typeId } });
      }

      window.addEventListener('message', function(event) {
        if (event.data.command === 'updateState') { location.reload(); }
      });
    `;

    return pageShell(nonce, 'Content Type', headerHtml, infoHtml + editHtml, scriptHtml, SHARED_STYLES);
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateContentType':
        try {
          await this.apiService.updateCourseContentType(message.data.typeId, message.data.updates);
          vscode.window.showInformationMessage('Content type updated successfully');

          if (this.treeDataProvider) {
            const courseData = this.currentData as { course: CourseList };
            this.treeDataProvider.updateNode('courseContentType', message.data.typeId, {
              ...message.data.updates,
              course_id: courseData?.course.id
            });
          } else {
            vscode.commands.executeCommand('computor.lecturer.refresh');
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update content type: ${error}`);
        }
        break;

      case 'refresh':
        if (message.data.typeId && this.panel) {
          try {
            const freshContentType = await this.apiService.getCourseContentType(message.data.typeId);
            if (freshContentType) {
              let kind = this.currentData?.contentKind;
              if (freshContentType.course_content_kind_id) {
                try {
                  const kinds = await this.apiService.getCourseContentKinds();
                  const freshKind = kinds.find(k => k.id === freshContentType.course_content_kind_id);
                  if (freshKind) { kind = freshKind; }
                } catch (error) {
                  console.error('Failed to refresh content kind:', error);
                }
              }

              this.currentData = { ...this.currentData, contentType: freshContentType, contentKind: kind };
              this.panel.webview.html = await this.getWebviewContent(this.currentData);
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
          }
        }
        break;

      case 'deleteContentType':
        vscode.commands.executeCommand('computor.deleteCourseContentType', message.data);
        this.panel?.dispose();
        break;
    }
  }
}
