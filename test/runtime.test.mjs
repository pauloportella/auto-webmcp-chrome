import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source=(await readFile(new URL('../src/control-utils.js',import.meta.url),'utf8'))+(await readFile(new URL('../src/search-tools.js',import.meta.url),'utf8'))+(await readFile(new URL('../src/form-runtime.js',import.meta.url),'utf8'));
for (const asynchronous of [false,true]) {
  test(`registration ${asynchronous ? 'rejection' : 'throw'} does not stop unrelated forms`, async()=>{
    const tools=new Map();
    const attributes=new Map();
    const forms=['bad','good'].map(name=>({
      tagName:'FORM',
      isConnected:true,
      matches:()=>true,
      getAttribute:key=>({'data-webmcp-complete-tool':name,'data-webmcp-tool-description':'Fill test form'})[key] || null,
      elements:[{name:'q',type:'text',tagName:'INPUT',matches:selector=>selector!==':disabled',getAttribute:()=>null}],
    }));
    const modelContext={
      getTools:async()=>[...tools.values()],
      registerTool(tool,{signal}) {
        if(tool.name==='bad') {
          if(asynchronous) return Promise.reject(new Error('registration failure'));
          throw new Error('registration failure');
        }
        tools.set(tool.name,tool);
        signal.addEventListener('abort',()=>tools.delete(tool.name));
        return Promise.resolve();
      },
    };
    vm.runInNewContext(source,{
      location:{hostname:"example.test",pathname:"/"},
      document:{modelContext,querySelectorAll:()=>forms,documentElement:{getAttribute:key=>attributes.get(key),setAttribute:(key,value)=>attributes.set(key,value)}},
      MutationObserver:class{observe(){}},
      AbortController,queueMicrotask,console:{warn(){}},
    });
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual([...tools.keys()],['good']);
    assert.deepEqual(JSON.parse(attributes.get('data-webmcp-registry-status')),{count:1,names:['good'],error:false});
  });
}

async function runtimeHarness({polyfill = false, search = false, reject} = {}) {
  const tools = new Map();
  const attributes = new Map();
  const attempts = [];
  let observer, discoveryCalls = 0;
  const listeners = new Map();
  const forms = ['fill_search', 'fill_other'].map(name => {
    const attrs = new Map([['data-webmcp-complete-tool', name], ['data-webmcp-tool-description', 'Fill test form']]);
    return {
      tagName: 'FORM', isConnected: true, matches: () => true,
      getAttribute: key => attrs.get(key) || null,
      setAttribute: (key, value) => attrs.set(key, value),
      elements: [{name: 'q', type: 'text', tagName: 'INPUT', matches: selector => selector !== ':disabled', getAttribute: () => null}],
    };
  });
  const duplicate = name => polyfill
    ? new Error(`Tool already registered: ${name}`)
    : new DOMException('Duplicate tool name', 'InvalidStateError');
  const modelContext = {
    __isWebMCPPolyfill: polyfill,
    getTools() { discoveryCalls++; throw new Error('Native discovery must not be called'); },
    async registerTool(tool, {signal}) {
      attempts.push(tool.name);
      const error = reject?.(tool.name, duplicate);
      if (error) throw error;
      if (tools.has(tool.name)) throw duplicate(tool.name);
      tools.set(tool.name, tool);
      signal.addEventListener('abort', () => tools.delete(tool.name));
    },
    addEventListener: (type, fn) => listeners.set(type, fn),
  };
  const root = {isConnected: true, getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value)};
  const context = {
    location: {hostname: search ? 'www.willhaben.at' : 'example.test', pathname: '/iad/kaufen-und-verkaufen'},
    document: {modelContext, querySelectorAll: () => forms.filter(form => form.isConnected), documentElement: root},
    MutationObserver: class {constructor(fn) {observer = fn;} observe() {}},
    AbortController, queueMicrotask, console: {warn() {}},
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return {
    tools, forms, attempts, duplicate,
    async start() {vm.runInNewContext(source, context); await settle();},
    async scan() {observer([{type: 'attributes', attributeName: 'id', target: forms[0]}]); await settle();},
    async changeTools() {for (let i = 0; i < 10; i++) listeners.get('toolchange')?.(); await settle();},
    status: () => JSON.parse(attributes.get('data-webmcp-registry-status')),
    discoveryCalls: () => discoveryCalls,
    root,
  };
}

for (const polyfill of [false, true]) {
  test(`${polyfill ? 'polyfill' : 'native'} collisions, status and removal never call discovery`, async () => {
    const harness = await runtimeHarness({polyfill, search: true});
    const siteFill = {name: 'fill_search'}, siteSearch = {name: 'search_willhaben'};
    harness.tools.set(siteFill.name, siteFill);
    harness.tools.set(siteSearch.name, siteSearch);
    await harness.start();
    assert.equal(harness.forms[0].getAttribute('data-webmcp-complete-tool'), 'fill_search_2');
    assert.equal(harness.tools.get(siteFill.name), siteFill);
    assert.equal(harness.tools.get(siteSearch.name), siteSearch);
    assert.deepEqual(harness.status(), {count: 3, names: ['fill_other', 'fill_search_2', 'search_willhaben_2'], error: false});
    const initialAttempts = [...harness.attempts];
    await harness.changeTools();
    await harness.scan();
    assert.deepEqual(harness.attempts, initialAttempts, 'Unchanged tools should not be registered again');
    harness.forms[0].isConnected = false;
    harness.root.isConnected = false;
    await harness.scan();
    assert.deepEqual(harness.status(), {count: 1, names: ['fill_other'], error: false});
    assert.equal(harness.tools.has('fill_search_2'), false);
    assert.equal(harness.tools.has('search_willhaben_2'), false);
    assert.equal(harness.tools.get(siteFill.name), siteFill);
    assert.equal(harness.tools.get(siteSearch.name), siteSearch);
    harness.forms[0].isConnected = true;
    harness.root.isConnected = true;
    await harness.scan();
    assert.equal(harness.status().count, 3);
    assert.equal(harness.discoveryCalls(), 0);
  });
}

test('inactive-document errors are not retried as name collisions', async () => {
  const harness = await runtimeHarness({reject: name => name === 'fill_search'
    ? new DOMException('Document is not active', 'InvalidStateError') : null});
  await harness.start();
  assert.deepEqual(harness.attempts, ['fill_search', 'fill_other']);
  assert.deepEqual([...harness.tools.keys()], ['fill_other']);
});

test('collision retries are bounded and do not block unrelated tools', async () => {
  const harness = await runtimeHarness({reject: (name, duplicate) => name.startsWith('fill_search') ? duplicate(name) : null});
  await harness.start();
  assert.equal(harness.attempts.filter(name => name.startsWith('fill_search')).length, 100);
  assert.deepEqual([...harness.tools.keys()], ['fill_other']);
  assert.equal(harness.discoveryCalls(), 0);
});
