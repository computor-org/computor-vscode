import { expect } from 'chai';
import { CourseAssistantBridge, resolveClientPolicy, CourseAssistantApi } from '../../src/services/CourseAssistantBridge';

describe('Computor tutor compatibility and policy bridge', () => {
  const legacy = { id: 'fixture-content', course_id: 'fixture-course', title: 'Synthetic exercise' };
  it('defaults the unchanged 26.10 DTO to Ask-only', () => {
    expect(resolveClientPolicy(undefined)).to.deep.equal({ actionMode: 'ask', completion: 'off', independentCheck: false });
    expect(resolveClientPolicy(null)).to.deep.equal(resolveClientPolicy(undefined));
  });
  it('maps the additive 27.3 response without enabling invalid policy', () => {
    expect(resolveClientPolicy({ action_mode: 'edit', completion: 'single-line', independent_check: false }))
      .to.deep.equal({ actionMode: 'edit', completion: 'single-line', independentCheck: false });
    for (const value of [{}, [], 'ask', { action_mode: 'yolo', completion: 'off', independent_check: false }]) {
      expect(resolveClientPolicy(value).independentCheck).to.equal(true);
    }
  });
  function harness() {
    const contexts: any[] = [], cleared: any[] = [], warnings: string[] = [];
    const api: CourseAssistantApi = { coursePolicyVersion: 1,
      applyCoursePolicy: context => { contexts.push(context); },
      clearCoursePolicy: scope => { cleared.push(scope); }, openChat: async () => {} };
    return { contexts, cleared, warnings, api };
  }
  it('applies, replaces and clears scoped policy while using only public task context', async () => {
    const h = harness();
    const bridge = new CourseAssistantBridge(async () => h.api, message => h.warnings.push(message));
    await bridge.apply({ ...legacy, assistant_guidance: 'Ask for the units before discussing numerical results.' });
    expect(h.contexts[0].scope).to.equal('computor:fixture-course/fixture-content');
    expect(h.contexts[0].policy.actionMode).to.equal('ask');
    expect(h.contexts[0].assignmentContext).to.equal('Synthetic exercise');
    expect(h.contexts[0].teachingPrompt).to.include('Ask for the units');
    await bridge.apply({ ...legacy, id: 'check', assistant_policy: {
      action_mode: 'ask', completion: 'off', independent_check: true } });
    expect(h.contexts[1].policy.independentCheck).to.equal(true);
    expect(h.contexts[2].scope).to.equal('computor:fixture-course/check');
    bridge.clear();
    expect(h.cleared).to.deep.equal(['computor:fixture-course/check']);
    expect(h.warnings).to.deep.equal([]);
  });
  it('missing Hackl does not break course tools', async () => {
    const bridge = new CourseAssistantBridge(async () => undefined, () => { throw new Error('unnecessary warning'); });
    await bridge.apply(legacy);
    bridge.clear();
  });
  it('logout wins a race with asynchronous extension activation', async () => {
    const h = harness();
    let release!: (api: CourseAssistantApi) => void;
    const bridge = new CourseAssistantBridge(() => new Promise(resolve => { release = resolve; }));
    const pending = bridge.apply(legacy);
    bridge.clear();
    release(h.api);
    await pending;
    expect(h.contexts).to.deep.equal([]);
  });
  it('failed replacement disables old generation and reports a bounded warning', async () => {
    const h = harness();
    let fail = false;
    const bridge = new CourseAssistantBridge(async () => {
      if (fail) throw new Error('provider credentials must not be logged');
      return h.api;
    }, message => h.warnings.push(message));
    await bridge.apply(legacy);
    fail = true;
    await bridge.apply({ ...legacy, id: 'new' });
    expect(h.contexts[h.contexts.length - 1].policy.independentCheck).to.equal(true);
    expect(h.warnings).to.have.length(1);
    expect(h.warnings[0]).not.to.include('credentials');
  });
});
