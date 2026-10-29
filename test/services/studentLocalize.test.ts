import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as vscode from 'vscode';

import { HttpClient } from '../../src/http/HttpClient';
import { ComputorApiService } from '../../src/services/ComputorApiService';
import { setUiAccount, setWorkspaceLaunchLanguage } from '../../src/utils/uiLanguage';
import { multiTierCache } from '../../src/services/CacheService';

class TestHttpClient extends HttpClient {
  async authenticate(): Promise<void> {}
  isAuthenticated(): boolean { return true; }
  getAuthHeaders(): Record<string, string> { return {}; }
}

/**
 * The student course and course-content endpoints return titles and
 * descriptions in the language named by `?localize=` (computor-org/issues#538);
 * without it a German course stays German for an English reader.
 */
describe('Student course requests in the reading language', () => {
  const env = vscode.env as { language: string };
  const display = env.language;
  let server: http.Server;
  let seen: string[];
  let api: ComputorApiService;

  beforeEach(async () => {
    seen = [];
    multiTierCache.clear();
    server = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(req.url?.startsWith('/students/course-contents/') || /^\/students\/courses\/[^?]/.test(req.url ?? '')
        ? JSON.stringify({ id: 'x' })
        : JSON.stringify([]));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new TestHttpClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 2000, 0, 0);
    api = new ComputorApiService({} as any, client);
    env.language = 'en';
  });

  afterEach(async () => {
    env.language = display;
    setUiAccount({});
    setWorkspaceLaunchLanguage(undefined);
    multiTierCache.clear();
    await new Promise(resolve => server.close(resolve));
  });

  it('asks for the reading language on the course and course-content endpoints', async () => {
    setUiAccount({ profile: { language_code: 'de' } });
    await api.getStudentCourses();
    await api.getStudentCourse('c1');
    await api.getStudentCourseContents('c1');
    await api.getStudentCourseContents();
    await api.getStudentCourseContent('k1');
    await api.getStudentCourseContentDetails('k1');
    expect(seen).to.deep.equal([
      '/students/courses?localize=de',
      '/students/courses/c1?localize=de',
      '/students/course-contents?course_id=c1&localize=de',
      '/students/course-contents?localize=de',
      '/students/course-contents/k1?localize=de',
      '/students/course-contents/k1?localize=de',
    ]);
  });

  it('fetches again after a language switch instead of reading the other language from the cache', async () => {
    await api.getStudentCourses();
    await api.getStudentCourseContents('c1');
    setUiAccount({ profile: { language_code: 'de' } });
    await api.getStudentCourses();
    await api.getStudentCourseContents('c1');
    expect(seen).to.deep.equal([
      '/students/courses?localize=en',
      '/students/course-contents?course_id=c1&localize=en',
      '/students/courses?localize=de',
      '/students/course-contents?course_id=c1&localize=de',
    ]);
  });

  it('clears the cached contents of every language', async () => {
    await api.getStudentCourseContents('c1');
    setUiAccount({ profile: { language_code: 'de' } });
    await api.getStudentCourseContents('c1');
    api.clearStudentCourseContentsCache('c1');
    setUiAccount({});
    await api.getStudentCourseContents('c1');
    expect(seen.at(-1)).to.equal('/students/course-contents?course_id=c1&localize=en');
    expect(seen).to.have.length(3);
  });
});
