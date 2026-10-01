const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('computor-org.computor');
  assert.ok(extension, 'Computor is installed in the real extension host');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const command of ['computor.publicCourses',
    'computor.login', 'computor.loginWithApiToken', 'computor.changeRealmUrl']) {
    assert.ok(commands.includes(command), `${command} remains available`);
  }
  // Public activation does not need a token, backend URL or installed Hackl.
  assert.equal(vscode.extensions.getExtension('computor-org.hackl'), undefined);
  const folder = vscode.workspace.workspaceFolders[0];
  const uri = vscode.Uri.joinPath(folder.uri, 'synthetic.py');
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  assert.equal(document.getText(), 'print(2 + 2)\n');
  assert.equal(extension.isActive, true);
};
