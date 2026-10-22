import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The backend compatibility guard (scripts/check-backend-compat.mjs) must
 * notice when a live backend line lacks an endpoint or a required field the
 * extension uses. Checked by removing both from a copy of the 2026.10 contract.
 */
describe('backend compatibility guard', function () {
  this.timeout(120000);
  const root = path.resolve(__dirname, '..', '..');
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'compat', 'backend-2026.10.json'), 'utf8'));

  function run(mutated: unknown): { status: number | null; out: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
    const file = path.join(dir, 'contract.json');
    fs.writeFileSync(file, JSON.stringify(mutated));
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-backend-compat.mjs')], {
      cwd: root,
      env: { ...process.env, COMPAT_CONTRACT: file },
      encoding: 'utf8'
    });
    fs.rmSync(dir, { recursive: true, force: true });
    return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
  }

  it('passes against the live 2026.10 contract', () => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-backend-compat.mjs')], {
      cwd: root,
      encoding: 'utf8'
    });
    expect(result.status, result.stderr).to.equal(0);
  });

  it('fails when a live line lacks an endpoint the extension calls', () => {
    const mutated = JSON.parse(JSON.stringify(contract));
    delete mutated.paths['/issue-reports'];
    const { status, out } = run(mutated);
    expect(status).to.equal(1);
    expect(out).to.contain('POST /issue-reports does not exist');
  });

  it('fails when a live line lacks a field the extension requires', () => {
    const mutated = JSON.parse(JSON.stringify(contract));
    delete mutated.schemas.IssueReportCreated.properties.report_id;
    const { status, out } = run(mutated);
    expect(status).to.equal(1);
    expect(out).to.contain('IssueReportCreated.report_id');
  });

  it('accepts a field the extension declares optional (feature-detected)', () => {
    // The 2026.10 contract has no issue_reporting.mode and no ticket_number;
    // the extension types them optional, so the unmodified run above passes.
    expect(contract.schemas.IssueReportingInfo.properties.mode).to.equal(undefined);
    expect(contract.schemas.IssueReportCreated.properties.ticket_number).to.equal(undefined);
  });
});
