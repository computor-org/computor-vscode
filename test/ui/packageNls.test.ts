import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

/** Every text VS Code shows from package.json, with where it sits. */
function contributedTexts(pkg: any): Array<[string, unknown]> {
  const c = pkg.contributes;
  const texts: Array<[string, unknown]> = [];
  for (const cmd of c.commands ?? []) {
    texts.push([`${cmd.command} title`, cmd.title]);
    for (const field of ['category', 'shortTitle'] as const) {
      if (cmd[field] !== undefined) texts.push([`${cmd.command} ${field}`, cmd[field]]);
    }
  }
  for (const container of Object.values(c.viewsContainers ?? {}).flat() as any[]) {
    texts.push([`${container.id} title`, container.title]);
  }
  for (const view of Object.values(c.views ?? {}).flat() as any[]) {
    texts.push([`${view.id} name`, view.name]);
    if (view.contextualTitle !== undefined) texts.push([`${view.id} contextualTitle`, view.contextualTitle]);
  }
  for (const menu of c.submenus ?? []) texts.push([`${menu.id} label`, menu.label]);
  for (const editor of c.customEditors ?? []) texts.push([`${editor.viewType} displayName`, editor.displayName]);
  for (const walkthrough of c.walkthroughs ?? []) {
    texts.push([`${walkthrough.id} title`, walkthrough.title], [`${walkthrough.id} description`, walkthrough.description]);
    for (const step of walkthrough.steps ?? []) {
      texts.push([`${walkthrough.id}/${step.id} title`, step.title], [`${walkthrough.id}/${step.id} description`, step.description]);
    }
  }
  return texts;
}

describe('package.json localization', () => {
  const pkg = read('package.json');
  const en = read('package.nls.json');
  const de = read('package.nls.de.json');

  it('takes every command, view, container and editor name from package.nls*.json', () => {
    const texts = contributedTexts(pkg);
    expect(texts.length).to.be.greaterThan(200);
    const missing: string[] = [];
    for (const [where, text] of texts) {
      const key = /^%(.+)%$/.exec(String(text))?.[1];
      if (!key) missing.push(`${where}: literal ${JSON.stringify(text)}`);
      else if (typeof en[key] !== 'string' || !en[key]) missing.push(`${where}: no English entry for ${key}`);
      else if (typeof de[key] !== 'string' || !de[key]) missing.push(`${where}: no German entry for ${key}`);
    }
    expect(missing).to.deep.equal([]);
  });
});
