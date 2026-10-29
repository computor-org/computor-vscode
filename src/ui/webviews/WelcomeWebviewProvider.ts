import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { showMarkdownPreview } from './markdownPreview';
import { focusViewContainer } from '../focusViewContainer';
import { containerById } from '../viewContainers';
import { notify } from '../../utils/notify';
import { say, uiLanguage } from '../../utils/uiLanguage';
import { helpPagePath } from '../../utils/studentHelpPages';
import {
  collectWelcomeFacts,
  renderWelcomeBody,
  resolveWelcomeMessage,
  welcomeRoleContainers,
  welcomeTitle,
  WelcomeApi,
  WelcomeIntent,
  WelcomeModel
} from './welcome/welcomeContent';

export const welcomeCommand = 'computor.welcome';

/** globalState key; absent means "show", so existing installs get the page once they update. */
const showOnStartupKey = 'computor.welcome.showOnStartup';

export function isWelcomeShownOnStartup(context: Pick<vscode.ExtensionContext, 'globalState'>): boolean {
  return context.globalState.get<boolean>(showOnStartupKey) !== false;
}

/** Where the provider gets what it cannot know by itself. */
export interface WelcomeSources {
  /** The API, only while a session is signed in. */
  api(): WelcomeApi | undefined;
  /** The backend URL this window is configured for. */
  backendUrl(): Promise<string | undefined>;
  /** The course this hosted workspace was launched for, once known. */
  launchedCourseId?(): string | undefined;
}

/**
 * The Computor welcome page (computor-org/issues#374).
 *
 * Shown after sign-in — in a Coder workspace that is the moment the workspace
 * opens — and from the "Welcome and Help" command at any time. Its content
 * lives in welcome/welcomeContent.ts; this class gathers the facts and carries
 * out what the page asks for.
 */
export class WelcomeWebviewProvider extends BaseWebviewProvider {
  private model?: WelcomeModel;
  /** The automatic display happens once per window, not on every re-login. */
  private shownAutomatically = false;

  constructor(context: vscode.ExtensionContext, private readonly sources: WelcomeSources) {
    super(context, 'computor.welcome');
  }

  async open(options?: { preserveFocus?: boolean }): Promise<void> {
    const model = await this.buildModel();
    await this.show(welcomeTitle(model), model, options);
    if (this.panel) {
      this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.png');
    }
  }

  /**
   * Called once a session is up. Opens the page if the user has not switched
   * it off, and refreshes it if it is already open — a page that said "sign in
   * to see your courses" should list them once you have.
   */
  async afterSignIn(): Promise<void> {
    if (this.panel) {
      await this.open({ preserveFocus: true });
      return;
    }
    // As on computor.at before: the Welcome page (#133) opens at every start,
    // a course launch included, until the learner switches it off.
    if (this.shownAutomatically || !isWelcomeShownOnStartup(this.context)) {
      return;
    }
    this.shownAutomatically = true;
    await this.open({ preserveFocus: true });
  }

  /** The page's language lives in its model, so build the model again. */
  override async refreshLanguage(): Promise<void> {
    await this.refresh().catch(error => console.warn('Welcome page could not be refreshed:', error));
  }

  /**
   * Re-render an open page in place, without bringing it to the front: a
   * course launched into a running workspace changes what the page says.
   */
  async refresh(): Promise<void> {
    if (!this.panel) return;
    const model = await this.buildModel();
    if (!this.panel) return;
    this.panel.title = welcomeTitle(model);
    this.panel.webview.html = await this.getWebviewContent(model);
  }

  private async buildModel(): Promise<WelcomeModel> {
    const facts = await collectWelcomeFacts(this.sources.api(), this.sources.launchedCourseId?.());
    return {
      ...facts,
      // Before sign-in there is no account to ask (computor-org/issues#366).
      language: facts.language ?? uiLanguage(),
      inBrowser: vscode.env.uiKind === vscode.UIKind.Web,
      workbenchLanguage: vscode.env.language?.toLowerCase().startsWith('de') ? 'de' : 'en',
      backendUrl: await this.sources.backendUrl().catch(() => undefined),
      version: this.context.extension?.packageJSON?.version,
      showOnStartup: isWelcomeShownOnStartup(this.context),
      logoDataUri: this.logoDataUri(),
      rowPictureSvg: this.rowPictureSvg()
    };
  }

  /** The annotated assignment row, shared with the walkthrough (package.json). */
  private rowPictureSvg(): string | undefined {
    try {
      return fs.readFileSync(path.join(this.context.extensionPath, 'media', 'welcome', 'assignment-row.svg'), 'utf8').trim();
    } catch {
      return undefined;
    }
  }

  private logoDataUri(): string | undefined {
    try {
      const png = fs.readFileSync(path.join(this.context.extensionPath, 'media', 'icon.png'));
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch {
      return undefined;
    }
  }

  protected async getWebviewContent(model?: WelcomeModel): Promise<string> {
    this.model = model;
    if (!model) {
      return this.getBaseHtml(welcomeTitle(), '<p>Loading…</p>');
    }
    return this.renderPage({
      title: welcomeTitle(model),
      bodyHtml: renderWelcomeBody(model),
      cssFiles: ['welcome/welcome.css'],
      scriptFiles: ['welcome/welcome.js']
    });
  }

  protected async handleMessage(message: unknown): Promise<void> {
    if (!this.model) return;
    const intent = resolveWelcomeMessage(message, this.model);
    if (intent) {
      await this.perform(intent);
    }
  }

  private async perform(intent: WelcomeIntent): Promise<void> {
    switch (intent.kind) {
      case 'help': {
        const helpPath = helpPagePath(this.context.extensionPath, intent.page);
        try {
          await showMarkdownPreview(this.context, helpPath, { title: say('Computor Help', 'Computor-Hilfe') });
        } catch (error) {
          console.error('[Welcome] Failed to open help page:', error);
          notify.error('Failed to open help documentation');
        }
        return;
      }
      case 'link':
        await vscode.env.openExternal(vscode.Uri.parse(intent.url));
        return;
      case 'view': {
        const container = containerById(welcomeRoleContainers[intent.role]);
        if (!container || !await focusViewContainer(container)) {
          notify.warning(`The ${intent.role} view is not available yet.`);
        }
        return;
      }
      case 'login':
        await vscode.commands.executeCommand('computor.login');
        return;
      case 'setBackend':
        await vscode.commands.executeCommand('computor.changeRealmUrl');
        await this.refresh();
        return;
      case 'reportProblem':
        await vscode.commands.executeCommand('computor.reportProblem');
        return;
      case 'showOnStartup':
        await this.context.globalState.update(showOnStartupKey, intent.value);
        if (this.model) this.model.showOnStartup = intent.value;
        return;
    }
  }
}

/** Register the command and hand back the page, for the post-sign-in display. */
export function registerWelcomePage(context: vscode.ExtensionContext, sources: WelcomeSources): WelcomeWebviewProvider {
  const page = new WelcomeWebviewProvider(context, sources);
  context.subscriptions.push(vscode.commands.registerCommand(welcomeCommand, () => page.open()));
  return page;
}
