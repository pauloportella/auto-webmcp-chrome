import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

// Run with CHROME_BIN pointing to an installed Chrome executable; no browser download.
for (const runtime of ['polyfill', 'native']) {
  test(`real Chrome form regressions (${runtime})`, {skip: !process.env.CHROME_BIN, timeout: 30000}, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'auto-webmcp-test-'));
    let server, child, socket, timer;
    try {
      const [html, bundle, content] = await Promise.all([
        readFile(new URL('./browser.html', import.meta.url), 'utf8'),
        readFile(new URL('../dist/webmcp-runtime.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/content.js', import.meta.url), 'utf8'),
      ]);
      const page = html.replace('<script>', () => `<script>${bundle}</script><script>${content}</script><script>`);
      server = createServer((_request, response) => {response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(page);});
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${server.address().port}/`;
      const profile = join(dir, 'profile');
      child = spawn(process.env.CHROME_BIN, ['--headless', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${profile}`, `--${runtime === 'native' ? 'enable' : 'disable'}-features=WebMCP`,
        '--disable-background-networking', '--remote-debugging-port=0', url]);
      let stderr = '', launchError;
      child.stderr.on('data', chunk => {stderr = (stderr + chunk).slice(-2000);});
      child.on('error', error => {launchError = error;});
      timer = setTimeout(() => child.kill(), 25000);
      let port;
      for (let attempt = 0; attempt < 100 && !port; attempt++) {
        if (launchError) throw launchError;
        if (child.exitCode !== null) throw new Error(`Chrome exited: ${stderr}`);
        try {port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);}
        catch {await new Promise(resolve => setTimeout(resolve, 50));}
      }
      assert.ok(port, `Chrome did not expose its test connection: ${stderr}`);
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(target => target.type === 'page');
      assert.ok(target, 'Chrome did not create the test page');
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true});});
      let sequence = 0;
      const pending = new Map();
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data), request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      });
      socket.addEventListener('close', () => {for (const request of pending.values()) request.reject(new Error(`Chrome test connection closed: ${stderr}`));});
      const evaluate = expression => new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, {resolve, reject});
        socket.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true, timeout: 20000}}));
      });
      // Await real native IPC and page promises; virtual-time dump-dom can exit mid-test.
      const response = await evaluate(`(async () => {
        if (document.readyState !== 'complete') await new Promise(resolve => addEventListener('load', resolve, {once:true}));
        await runRegressionTests();
        return {runtime: document.documentElement.getAttribute('data-webmcp-form-runtime'), results: JSON.parse(document.getElementById('results').textContent)};
      })()`);
      assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
      const result = response.result.value;
      assert.equal(result.runtime, runtime);
      assert.equal(result.results.length, 22);
      assert.deepEqual(result.results.filter(result => !result.pass), []);
    } finally {
      clearTimeout(timer);
      socket?.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise(resolve => {child.once('exit', resolve); child.kill();});
      }
      server?.close();
      await rm(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
  });
}
