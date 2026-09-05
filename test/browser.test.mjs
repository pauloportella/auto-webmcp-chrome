import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

// Run with CHROME_BIN pointing to an installed Chrome executable; no browser download.
test('real Chrome form regressions', {skip: !process.env.CHROME_BIN, timeout: 30000}, async () => {
  const dir=await mkdtemp(join(tmpdir(),'auto-webmcp-test-'));
  let server;
  try {
    const [html,bundle,content]=await Promise.all([
      readFile(new URL('./browser.html',import.meta.url),'utf8'),
      readFile(new URL('../dist/webmcp-runtime.js',import.meta.url),'utf8'),
      readFile(new URL('../src/content.js',import.meta.url),'utf8'),
    ]);
    const page=html.replace('<script>',()=>`<script>${bundle}</script><script>${content}</script><script>`).replace('</html>', '<script>runRegressionTests()</script></html>');
    server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page);});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const output=await new Promise((resolve,reject) => {
      const child=spawn(process.env.CHROME_BIN,['--headless','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(dir,'profile')}`,'--disable-background-networking','--dump-dom','--virtual-time-budget=10000',`http://127.0.0.1:${server.address().port}/`]);
      let stdout='',stderr='';
      const timer=setTimeout(()=>{child.kill();reject(new Error(`Chrome capture timed out: ${stderr.slice(-1000)}`));},20000);
      child.stdout.on('data',chunk=>{
        stdout+=chunk;
        if(stdout.includes('</html>')) {clearTimeout(timer);child.kill();resolve(stdout);}
      });
      child.stderr.on('data',chunk=>{stderr+=chunk;});
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('exit',()=>{clearTimeout(timer);if(!stdout.includes('</html>')) reject(new Error(`Chrome exited without results: ${stderr.slice(-1000)}`));});
    });
    const match=output.match(/<pre id="results"[^>]*data-complete="true"[^>]*>([\s\S]*?)<\/pre>/);
    assert.ok(match,'Browser did not finish the regression suite');
    const results=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));
    assert.equal(results.length,21);
    assert.deepEqual(results.filter(result=>!result.pass),[]);
  } finally {
    server?.close();
    await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
