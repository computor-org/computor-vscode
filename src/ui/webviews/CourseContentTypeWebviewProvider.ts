import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseContentTypeGet, CourseList, CourseContentKindList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { escapeHtml, infoRowText, infoRowCode, infoRow, section, badge, colorSwatch, formGroup, textInput, textareaInput, detailGrid } from './shared/webviewHelpers';
import { notify } from '../../utils/notify';
import { say, uiLanguage } from '../../utils/uiLanguage';
import { localizedKindTitle } from '../../utils/contentLanguage';
import { showErrorWithSeverity } from '../../utils/errorDisplay';

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
      return this.getBaseHtml(say('Content Type', 'Inhaltstyp'), say('<p>No content type data available</p>', '<p>Keine Daten zum Inhaltstyp verfügbar</p>'));
    }

    const { contentType, course, contentKind } = data;

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
      <p>${say('Content Type in', 'Inhaltstyp in')} ${escapeHtml(course?.title || course?.path)}</p>`;

    const kindBadges = kind ? `
      ${infoRow(say('Submittable', 'Mit Abgabe'), kind.submittable ? badge(say('Yes', 'Ja'), 'success') : badge(say('No', 'Nein'), 'muted'))}
      ${infoRow(say('Can Have Children', 'Kann Untereinträge haben'), kind.has_descendants ? badge(say('Yes', 'Ja'), 'info') : badge(say('No', 'Nein'), 'muted'))}
      ${infoRow(say('Can Have Parent', 'Kann übergeordnet eingeordnet werden'), kind.has_ascendants ? badge(say('Yes', 'Ja'), 'info') : badge(say('No', 'Nein'), 'muted'))}
    ` : '';

    const detailsHtml = section(say('Content Type', 'Inhaltstyp'), `
      ${detailGrid(`
      ${infoRowCode('ID', contentType.id)}
      ${infoRowText(say('Content Kind', 'Inhaltsart'), localizedKindTitle(contentType.course_content_kind_id, kind?.title, uiLanguage()))}
      ${kindBadges}
    `)}
      <form id="editForm">
        ${formGroup(say('Title', 'Titel'), textInput('title', contentType.title, { placeholder: say('Content type title', 'Titel des Inhaltstyps') }))}
        ${formGroup('Slug', textInput('slug', contentType.slug, { required: true, pattern: '[a-z0-9_-]+', placeholder: 'content-type-slug' }))}
        ${formGroup(say('Color', 'Farbe'), `
          <div class="color-input-row">
            <input type="color" id="colorPicker" value="${escapeHtml(color)}">
            <input type="text" id="colorText" name="color" value="${escapeHtml(color)}" placeholder="#000000">
          </div>
        `)}
        ${formGroup(say('Description', 'Beschreibung'), textareaInput('description', contentType.description, { placeholder: say('Content type description', 'Beschreibung des Inhaltstyps') }))}
        <div class="actions">
          <button type="submit">${say('Save Changes', 'Änderungen speichern')}</button>
          <button type="button" class="btn-secondary" data-action="refreshData">${say('Refresh', 'Aktualisieren')}</button>
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

      ComputorWebview.registerActions({ refreshData: refreshData });
      ComputorWebview.onCommand('updateState', function() { location.reload(); });
    `;

    return this.renderPage({ title: say('Content Type', 'Inhaltstyp'), headerHtml, bodyHtml: detailsHtml, inlineScript: scriptHtml });
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateContentType':
        try {
          await this.apiService.updateCourseContentType(message.data.typeId, message.data.updates);
          notify.info(say('Content type updated successfully', 'Der Inhaltstyp wurde aktualisiert.'));

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
          showErrorWithSeverity(error as Error, say('Failed to update content type', 'Der Inhaltstyp konnte nicht aktualisiert werden'));
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
            notify.error(say(`Failed to refresh: ${error}`, `Aktualisieren fehlgeschlagen: ${error}`));
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
