const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../public/dashboard.js'), 'utf8');
function setup(response) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, setAttribute() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    window: { location: { search: '' }, _currentUser: { roles: ['authenticated', 'admin', 'it_support_approve', 'tester_appservice_manager'] } },
    document: { getElementById: get }, URLSearchParams,
    setText: (id, value) => { get(id).textContent = value; },
    formatDisplayRoles: roles => roles.join(', '),
    safeFetchJson: async () => { if (response instanceof Error) throw response; return response; }
  });
  vm.runInContext(source.slice(source.indexOf('async function loadAdoAuthStatus'), source.indexOf('function startAdoConnect')), context);
  return { context, get };
}
test('account shows initials, approval role first, and remaining roles without system roles', () => {
  const { context, get } = setup();
  get('displayName').textContent = 'Kiattisak Yo';
  vm.runInContext('renderAccountOverview()', context);
  assert.equal(get('accountAvatar').textContent, 'KY');
  assert.equal(get('accountPrimaryRole').textContent, 'it_support_approve');
  assert.equal(get('accountMoreRoles').textContent, '+2 ▾');
  assert.equal(get('accountRolesDetails').hidden, false);
  assert.doesNotMatch(get('userRole').textContent, /authenticated/);
  context.window._currentUser.roles = ['it_support_approve'];
  vm.runInContext('renderAccountOverview()', context);
  assert.equal(get('accountRolesDetails').hidden, true);
});
test('connection keeps account details in Manage and exposes reconnect only when needed', async () => {
  for (const connected of [true, false]) {
    const { context, get } = setup({ ok: true, data: { ok: true, connected, user: 'user@example.com' } });
    await vm.runInContext('loadAdoAuthStatus()', context);
    assert.equal(get('btnQuickConnectAdo').hidden, connected);
    assert.equal(get('btnDisconnectAdo').hidden, !connected);
    assert.equal(get('adoConnectionStatus').textContent, connected ? 'Azure DevOps connected' : 'Azure DevOps disconnected');
    if (connected) assert.match(get('adoConnectionIdentity').textContent, /user@example.com/);
  }
  const { context, get } = setup(new Error('offline'));
  await vm.runInContext('loadAdoAuthStatus()', context);
  assert.equal(get('btnQuickConnectAdo').hidden, false);
  assert.equal(get('btnDisconnectAdo').hidden, true);
  assert.equal(get('adoConnectionStatus').textContent, 'Azure DevOps status unavailable');
});

test('account menus stay open inside, close outside, and support Escape with focus restoration', () => {
  const handlers = {};
  let focused = false;
  const inside = {};
  const outside = {};
  const details = { open: true, contains: target => target === inside,
    querySelector: () => ({ focus: () => { focused = true; } }) };
  const document = { addEventListener: (name, handler) => { handlers[name] = handler; },
    querySelectorAll: () => details.open ? [details] : [], activeElement: inside };
  const context = vm.createContext({ document });
  vm.runInContext(source.slice(source.indexOf('function initAccountDismissal'), source.indexOf('function startAdoConnect')), context);
  vm.runInContext('initAccountDismissal()', context);
  handlers.click({ target: inside });
  assert.equal(details.open, true);
  handlers.click({ target: outside });
  assert.equal(details.open, false);
  assert.equal(focused, false);
  details.open = true;
  handlers.keydown({ key: 'Enter' });
  assert.equal(details.open, true);
  handlers.keydown({ key: 'Escape' });
  assert.equal(details.open, false);
  assert.equal(focused, true);
});
