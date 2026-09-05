// Declarative GET routing only. Discovery never submits, clicks, or makes requests.
(() => {
  const controls = globalThis.__autoWebMcpControls;
  function plan(form) {
    if (form === document.documentElement) {
      if (location.hostname !== 'www.willhaben.at' || !location.pathname.startsWith('/iad/kaufen-und-verkaufen')) return null;
      // ponytail: small verified adapter; expand locations only after validating their URL mappings.
      return {name: 'search_willhaben', title: 'Search Willhaben', adapter: true, schema: {
        type: 'object', properties: {
          query: {type: 'string', minLength: 1, description: 'Furniture or other marketplace search term'},
          area: {type: 'string', enum: ['all', 'Styria', 'Graz', 'Graz-Umgebung']},
          minimumPrice: {type: 'integer', minimum: 0}, maximumPrice: {type: 'integer', minimum: 0},
          condition: {type: 'string', enum: ['any', 'used']},
          sort: {type: 'string', enum: ['newest', 'cheapest']},
        }, required: ['query'], additionalProperties: false,
      }};
    }
    if (form.tagName !== 'FORM' || String(form.method || '').toLowerCase() !== 'get' ||
        !form.matches('form[role="search"], search form') && !form.querySelector('input[type="search"]')) return null;
    const action = new URL(form.getAttribute('action') || location.href, document.baseURI);
    if (action.origin !== location.origin || !/^https?:$/.test(action.protocol) || form.target && form.target !== '_self') return null;
    // Image submitters are intentionally absent from form.elements.
    if ([...document.querySelectorAll('input[type="image"]')].some(e => e.form === form)) return null;
    const elements = [...form.elements];
    if (elements.some(e => ['password','file','image'].includes(e.type) || e.hasAttribute('dirname') || e.hasAttribute('formaction') || e.hasAttribute('formmethod') || e.hasAttribute('formtarget'))) return null;
    const submitters = elements.filter(e => e.type === 'submit' && !e.matches(':disabled'));
    if (submitters.length > 1) return null;
    const editable = elements.filter(controls.eligible);
    // Unnamed inputs cannot be represented in native GET serialization.
    if (!editable.length || editable.some(e => !e.name)) return null;
    return {action: action.href, submitter: submitters[0]};
  }
  function url(form, args, assignments) {
    const route = plan(form);
    if (!route || !form.isConnected) throw new Error('Search routing changed. Discover tools again.');
    if (route.adapter) {
      const {query, area='all', minimumPrice, maximumPrice, condition='any', sort='newest'} = args;
      const areas = {all: null, Styria: '6', Graz: '601', 'Graz-Umgebung': '606'};
      if (typeof query !== 'string' || !query.trim() || !Object.hasOwn(areas, area) || !['any','used'].includes(condition) || !['newest','cheapest'].includes(sort) ||
          [minimumPrice,maximumPrice].some(v => v !== undefined && (!Number.isSafeInteger(v) || v < 0)) || minimumPrice > maximumPrice ||
          Object.keys(args).some(k => !Object.hasOwn(route.schema.properties,k))) throw new Error('Invalid search parameters.');
      const target = new URL('/iad/kaufen-und-verkaufen/marktplatz' + (condition === 'used' ? '/a/zustand-gebraucht-23' : ''), location.origin);
      target.searchParams.set('keyword',query);
      if (areas[area]) target.searchParams.set('areaId',areas[area]);
      if (minimumPrice !== undefined) target.searchParams.set('PRICE_FROM',minimumPrice);
      if (maximumPrice !== undefined) target.searchParams.set('PRICE_TO',maximumPrice);
      if (sort === 'cheapest') target.searchParams.set('sort','3');
      return target;
    }
    const edits = new Map();
    for (const [name,value] of Object.entries(args)) for (const edit of assignments(form,name,value)) edits.set(edit.control,edit);
    const read = (element, property) => edits.get(element)?.property === property ? edits.get(element).value : element[property];
    const params = new URLSearchParams();
    for (const field of form.elements) {
      if (!field.name || field.matches(':disabled') || !field.matches('input,select,textarea,button')) continue;
      if (['button','reset'].includes(field.type) || field.type === 'submit' && field !== route.submitter) continue;
      if (['checkbox','radio'].includes(field.type) && !read(field,'checked')) {
        if (field.required && (field.type === 'checkbox' || ![...form.elements].some(e => e.type === 'radio' && e.name === field.name && read(e,'checked')))) throw new Error('A search field is required.');
        continue;
      }
      if (field.tagName === 'SELECT') {
        const copy = field.cloneNode(true);
        if (field.multiple) [...copy.options].forEach((option,index) => { option.selected = read(field.options[index],'selected'); });
        else copy.selectedIndex = read(field,'selectedIndex');
        if (!copy.validity.valid) throw new Error('A search field is invalid.');
        for (const option of field.options) if ((field.multiple ? read(option,'selected') : [...field.options].indexOf(option) === read(field,'selectedIndex')) && !option.disabled && !option.closest('optgroup[disabled]')) params.append(field.name,option.value);
      } else {
        const value = field.type === 'hidden' && field.name === '_charset_' ? 'UTF-8' : read(field,'value');
        if (field.type !== 'hidden' && field.type !== 'submit') {
          const copy = field.cloneNode(true);
          copy.value = value;
          if (['checkbox','radio'].includes(field.type)) copy.checked = read(field,'checked');
          if (!copy.validity.valid) throw new Error('A search field is invalid.');
        }
        params.append(field.name,String(value).replace(/\r\n|\r|\n/g,'\r\n'));
      }
    }
    const target = new URL(route.action);
    target.search = params.toString();
    return target;
  }
  globalThis.__autoWebMcpSearch = {plan,url};
})();
