import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { runInNewContext } from 'vm';
import * as vscode from 'vscode';
import { MessagesInputPanelProvider } from '../../src/ui/panels/MessagesInputPanel';
import { setUiCourseLanguage, setUiProfileLanguage } from '../../src/utils/uiLanguage';

const english = {
  plain: 'Write your message… (Ctrl/Cmd+Enter to send, Markdown, @ to mention)',
  tutor: 'Write your message… (Ctrl/Cmd+Enter to send; @lena, @luna or @ai for Lena; @ for people)'
};
const german = {
  plain: 'Schreib deine Nachricht… (Strg/Cmd+Enter zum Senden, Markdown, @ zum Erwähnen)',
  tutor: 'Schreib deine Nachricht… (Strg/Cmd+Enter zum Senden; @lena, @luna oder @ai für Lena; @ für Personen)'
};

describe('message composer locale', () => {
  afterEach(() => { setUiProfileLanguage(undefined); setUiCourseLanguage(undefined); });

  function fixture() {
    const messages: any[] = [];
    const view = { webview: { postMessage: (message: any) => messages.push(message) } };
    const provider = new MessagesInputPanelProvider(vscode.Uri.file(path.resolve(__dirname, '../..')), {} as any);
    (provider as any).view = view;
    return { provider, messages };
  }

  for (const [profile, course, expected] of [
    ['de', 'en', german], ['en', 'de', english], [undefined, 'de', german], [undefined, 'en', english], [undefined, undefined, english]
  ] as const) {
    it(`uses profile ${profile || 'Automatic'} over course ${course}`, () => {
      setUiProfileLanguage(profile); setUiCourseLanguage(course);
      const { provider, messages } = fixture();
      (provider as any).postState();
      expect(messages[0].data.editorPlaceholders).to.deep.equal(expected);
    });
  }

  it('renders supplied ordinary and tutor placeholders, preserving the English fallback', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../webview-ui/messaging/messages-input.js'), 'utf8');
    for (const placeholders of [undefined, english, german]) {
      const handlers: Record<string, Function> = {};
      let placeholder: string | undefined;
      const node = () => ({ style: {}, appendChild() {}, addEventListener() {}, childNodes: [],
        setAttribute(key: string, value: string) { if (key === 'data-placeholder') placeholder = value; } });
      const mount = node();
      const window = { __INITIAL_STATE__: { editorPlaceholders: placeholders },
        addEventListener: (name: string, handler: Function) => { handlers[name] = handler; },
        ComputorWebview: { vscode: { postMessage() {} }, escapeHtml: (text: string) => text,
          mention: { hasTutorAliases: () => true },
          el: (tag: string, props: any) => {
            const element = node();
            for (const [key, value] of Object.entries(props.attributes || {})) element.setAttribute(key, String(value));
            return element;
          },
          createStore(initial: any, render: Function) {
            return { state: initial, setState(patch: any) { Object.assign(initial, patch); render(); } };
          }
        } };
      runInNewContext(source, { window, document: { getElementById: () => mount, addEventListener() {} } });
      handlers.message!({ data: { command: 'updateState', data: { target: { title: 'Course' } } } });
      expect(placeholder).to.equal((placeholders || english).plain);
      handlers.message!({ data: { command: 'mentionableUsers', data: { users: [] } } });
      expect(placeholder).to.equal((placeholders || english).tutor);
    }
  });
});
