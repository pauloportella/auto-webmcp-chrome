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
