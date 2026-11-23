'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var test = require('node:test');
var vm = require('node:vm');
var groupFilter = require('../v10/group-filter.js');

function FakeElement(id) {
  this.id = id;
  this.value = '';
  this.textContent = '';
  this.innerHTML = '';
  this.disabled = false;
  this.className = '';
  this.style = {};
  this.listeners = {};
  this.classList = { toggle: function () {} };
  this.checkboxes = [];
  this.options = [];
  this.table = {
    style: {},
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
}

FakeElement.prototype.addEventListener = function (name, callback) {
  this.listeners[name] = callback;
};

FakeElement.prototype.dispatch = function (name) {
  if (this.listeners[name]) this.listeners[name].call(this, { stopPropagation: function () {} });
};

FakeElement.prototype.querySelectorAll = function (selector) {
  if (selector === '.hos-driver-chk') return this.checkboxes;
  if (selector === '.hos-driver-chk:checked') return this.checkboxes.filter(function (checkbox) { return checkbox.checked; });
  if (selector === '.hos-driver-opt') return this.options;
  return [];
};

FakeElement.prototype.querySelector = function (selector) {
  if (selector === '.hos-table') return this.table;
  return null;
};

FakeElement.prototype.setInnerHTML = function (html) {
  this._innerHTML = html;
  if (this.id !== 'hos-driver-list') return;

  var list = this;
  this.checkboxes = [];
  this.options = [];
  html.replace(/<label class="hos-driver-opt"[^>]*>(.*?)<\/label>/g, function (_, content) {
    var tag = content.match(/<input[^>]+>/)[0];
    var value = (tag.match(/value="([^"]*)"/) || [])[1] || '';
    var name = (tag.match(/data-driver-name="([^"]*)"/) || [])[1] || '';
    var checkbox = {
      value: value,
      checked: /\schecked(?:\s|>)/.test(tag),
      style: {},
      listeners: {},
      getAttribute: function (attribute) { return attribute === 'data-driver-name' ? name : null; },
      addEventListener: function (event, callback) { this.listeners[event] = callback; }
    };
    var option = {
      style: {},
      querySelector: function () { return checkbox; }
    };
    list.checkboxes.push(checkbox);
    list.options.push(option);
    return '';
  });
};

Object.defineProperty(FakeElement.prototype, 'innerHTML', {
  get: function () { return this._innerHTML || ''; },
  set: function (html) { this.setInnerHTML(html); }
});

test('the v10 add-in applies MyGeotab group changes to report tables and driver options on focus', function () {
  var elements = {};
  function element(id) {
    if (!elements[id]) elements[id] = new FakeElement(id);
    return elements[id];
  }

  var document = {
    head: { appendChild: function () {} },
    body: { style: {} },
    getElementById: function (id) { return id === 'hos-styles' ? null : element(id); },
    createElement: function (tag) { return new FakeElement(tag); },
    addEventListener: function () {}
  };
  var workbook = null;
  var writeCount = 0;
  var throwOnWrite = false;
  var fakeXlsx = {
    utils: {
      book_new: function () { return { sheets: [] }; },
      aoa_to_sheet: function (rows) { return { rows: rows }; },
      book_append_sheet: function (book, sheet, name) { book.sheets.push({ name: name, rows: sheet.rows }); }
    },
    writeFile: function (book) {
      if (throwOnWrite) throw new Error('mock write failure');
      workbook = book;
      writeCount++;
    }
  };
  var window = { geotab: { addin: {} }, XLSX: fakeXlsx, HOSGroupFilter: groupFilter };
  var groupGets = 0;
  var failGroupGet = false;
  var deferGroupGet = false;
  var pendingGroupGets = [];
  var groupResultOverride = null;
  var hosLogGets = 0;
  var boundaryStatusLog = null;
  var userResultOverride = null;
  var groupList = [
    { id: 'GroupCompanyId', name: 'Company', children: [{ id: 'north' }, { id: 'south' }] },
    { id: 'north', name: 'North', children: [{ id: 'north-child' }] },
    { id: 'north-child', name: 'North Child', children: [] },
    { id: 'south', name: 'South', children: [] }
  ];
  var api = {
    call: function (method, params, success, failure) {
      if (params.typeName === 'User') {
        success(userResultOverride || [
          { id: 'north-driver', firstName: 'North', lastName: 'Driver', hosRuleSet: 'US', companyGroups: [{ id: 'north-child' }], driverGroups: [{ id: 'north-child' }] },
          { id: 'south-driver', firstName: 'South', lastName: 'Driver', hosRuleSet: 'US', companyGroups: [{ id: 'south' }], driverGroups: [{ id: 'south' }] }
        ]);
      } else if (params.typeName === 'Group') {
        groupGets++;
        if (failGroupGet) { failure(new Error('Group API unavailable')); return; }
        if (deferGroupGet) {
          pendingGroupGets.push({
            scope: selectedGroups.map(function (group) { return group.id; }).sort().join(','),
            success: success,
            failure: failure
          });
          return;
        }
        success(groupResultOverride || groupList);
      } else {
        if (params.typeName === 'DutyStatusLog') {
          hosLogGets++;
          if (params.search && params.search.includeBoundaryLogs) {
            success(boundaryStatusLog ? [boundaryStatusLog] : []);
            return;
          }
        }
        success([]);
      }
    },
    getSession: function (callback) { callback({ database: 'test' }, 'my.geotab.com'); }
  };
  var indexPath = process.env.HOS_INDEX || path.join(__dirname, '..', 'v10', 'index.html');
  var script = fs.readFileSync(indexPath, 'utf8')
    .match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  var context = { window: window, document: document, HOSGroupFilter: groupFilter, XLSX: fakeXlsx, console: console, Date: Date, Set: Set, alert: function () {} };
  vm.runInNewContext(script, context);

  var selectedGroups = [{ id: 'north' }];
  var advancedFilter = null;
  var state = {
    getAdvancedGroupFilter: function () { return advancedFilter; },
    getGroupFilter: function () { return selectedGroups; }
  };
  function resolvePendingGroup(scope) {
    var index = pendingGroupGets.findIndex(function (request) { return request.scope === scope; });
    assert.notEqual(index, -1, 'expected a deferred group request for ' + scope);
    var request = pendingGroupGets.splice(index, 1)[0];
    request.success(groupList);
  }
  var addin = window.geotab.addin.driverHOSReport(api, state);
  addin.initialize(api, state, function () {});
  element('hos-run-btn').dispatch('click');

  assert.match(element('hos-summary-wrap').innerHTML, /Driver, North/);
  assert.doesNotMatch(element('hos-summary-wrap').innerHTML, /Driver, South/);
  assert.match(element('hos-detail-wrap').innerHTML, /Driver, North/);
  assert.doesNotMatch(element('hos-detail-wrap').innerHTML, /Driver, South/);
  assert.deepEqual(element('hos-driver-list').checkboxes.map(function (checkbox) { return checkbox.value; }), ['north-driver']);
  assert.equal(element('hos-group-scope').textContent, 'Groups: North');

  element('hos-preset-select').value = 'thisMonth';
  element('hos-preset-select').dispatch('change');
  assert.equal(element('hos-download-btn').disabled, true, 'changing the range invalidates the completed report');
  addin.focus(api, state);
  assert.equal(element('hos-download-btn').disabled, true, 'focus must not re-enable an export for the old range');
  element('hos-preset-select').value = 'custom';
  element('hos-preset-select').dispatch('change');
  element('hos-start-date').value = '2026-11-16';
  element('hos-end-date').value = '2026-11-22';
  element('hos-apply-btn').dispatch('click');
  boundaryStatusLog = {
    driver: { id: 'north-driver' },
    dateTime: '2026-07-01T00:00:00.000Z',
    status: 'ON'
  };
  element('hos-run-btn').dispatch('click');
  assert.equal(element('hos-download-btn').disabled, false);
  var northRow = element('hos-summary-wrap').innerHTML.match(/<tr[^>]*><td class="hos-driver-cell">Driver, North<\/td>[\s\S]*?<\/tr>/)[0];
  var northStatusCells = Array.from(northRow.matchAll(/<td class="hos-num[^\"]*">([\s\S]*?)<\/td>/g), function (match) { return match[1]; });
  assert.equal(northStatusCells[0].includes('24:00'), false, 'a carried ON status must not be reported as OFF');
  assert.equal(northStatusCells[3], '24:00', 'the last status before the report range must carry into it even when older than 30 days');
  assert.equal(northStatusCells[6], '24:00', 'a stale ON status must fill each last-week day');
  boundaryStatusLog = null;

  var northCheckbox = element('hos-driver-list').checkboxes[0];
  northCheckbox.checked = true;
  northCheckbox.listeners.change();

  selectedGroups = [{ id: 'south' }];
  addin.focus(api, state);

  assert.doesNotMatch(element('hos-summary-wrap').innerHTML, /Driver, North/);
  assert.doesNotMatch(element('hos-summary-wrap').innerHTML, /Driver, South/);
  assert.doesNotMatch(element('hos-detail-wrap').innerHTML, /Driver, North/);
  assert.doesNotMatch(element('hos-detail-wrap').innerHTML, /Driver, South/);
  assert.deepEqual(element('hos-driver-list').checkboxes.map(function (checkbox) { return checkbox.value; }), ['south-driver']);
  assert.equal(element('hos-group-scope').textContent, 'Groups: South');
  assert.equal(element('hos-driver-badge').textContent, '0', 'a selected set pruned to empty must remain empty');

  element('hos-driver-clear').dispatch('click');
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, South/);
  assert.equal(element('hos-driver-badge').style.display, 'none', 'Clear restores the all-drivers mode');

  var southCheckbox = element('hos-driver-list').checkboxes[0];
  southCheckbox.checked = true;
  southCheckbox.listeners.change();
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, South/);
  element('hos-driver-clear').dispatch('click');
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, South/);
  assert.equal(element('hos-driver-badge').style.display, 'none');
  southCheckbox.checked = true;
  southCheckbox.listeners.change();
  southCheckbox.checked = false;
  southCheckbox.listeners.change();
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, South/, 'manually unchecking the last driver restores all drivers');

  // Export refreshes the host state and synchronizes the visible tables before writing the workbook.
  selectedGroups = [{ id: 'north' }];
  element('hos-download-btn').dispatch('click');
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, North/);
  assert.doesNotMatch(element('hos-summary-wrap').innerHTML, /Driver, South/);
  assert.match(workbook.sheets[0].rows.map(function (row) { return row.join(' '); }).join(' '), /Driver, North/);
  assert.doesNotMatch(workbook.sheets[0].rows.map(function (row) { return row.join(' '); }).join(' '), /Driver, South/);

  throwOnWrite = true;
  element('hos-download-btn').dispatch('click');
  assert.match(element('hos-status').innerHTML, /Unable to create the Excel file/);
  assert.equal(element('hos-download-btn').disabled, false, 'a failed write releases the export lock');
  assert.equal(element('hos-run-btn').disabled, false);
  throwOnWrite = false;

  // A focus during an in-flight export changes the request generation; the export retries at the latest scope.
  deferGroupGet = true;
  selectedGroups = [{ id: 'south' }];
  element('hos-download-btn').dispatch('click');
  var logGetsBeforeBlockedRun = hosLogGets;
  var writesBeforeBlockedRun = writeCount;
  element('hos-run-btn').dispatch('click');
  assert.equal(hosLogGets, logGetsBeforeBlockedRun, 'Run is blocked while export scope is resolving');
  assert.equal(writeCount, writesBeforeBlockedRun, 'a blocked Run cannot cause a spurious workbook');
  selectedGroups = [{ id: 'north' }];
  addin.focus(api, state);
  resolvePendingGroup('north');
  resolvePendingGroup('south');
  resolvePendingGroup('north');
  assert.equal(writeCount, 2, 'an intervening focus must not silently cancel an export');
  assert.match(workbook.sheets[0].rows.map(function (row) { return row.join(' '); }).join(' '), /Driver, North/);
  assert.doesNotMatch(workbook.sheets[0].rows.map(function (row) { return row.join(' '); }).join(' '), /Driver, South/);
  deferGroupGet = false;

  selectedGroups = [];
  failGroupGet = true;
  var groupGetsBeforeWholeCompany = groupGets;
  addin.focus(api, state);

  assert.match(element('hos-summary-wrap').innerHTML, /Driver, North/);
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, South/);
  assert.equal(element('hos-group-scope').textContent, 'Groups: Entire company');
  assert.equal(groupGets, groupGetsBeforeWholeCompany, 'whole-company scope must not fetch the group hierarchy');

  advancedFilter = {
    relation: 'And',
    groupFilterConditions: [
      { groupId: 'GroupCompanyId' },
      { relation: 'Or', groupFilterConditions: [{ groupId: 'north' }, { groupId: 'north-child' }] }
    ]
  };
  failGroupGet = false;
  addin.focus(api, state);
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, North/);
  assert.doesNotMatch(element('hos-summary-wrap').innerHTML, /Driver, South/);
  assert.doesNotMatch(element('hos-group-scope').textContent, /Company/);

  advancedFilter = null;
  state.getGroupFilter = function () { throw new Error('host filter read failed'); };
  addin.focus(api, state);
  assert.doesNotMatch(element('hos-summary-wrap').innerHTML, /Driver, North|Driver, South/);
  assert.equal(element('hos-download-btn').disabled, true);
  assert.match(element('hos-status').innerHTML, /Unable to read the MyGeotab group filter/);
  assert.equal(element('hos-run-btn').disabled, false, 'scope errors must release report controls');
  assert.equal(element('hos-driver-btn').disabled, true);
  element('hos-driver-clear').dispatch('click');
  assert.equal(element('hos-download-btn').disabled, true, 'clearing selection in an error state is safe and cannot re-enable export');

  state.getGroupFilter = function () { return selectedGroups; };
  failGroupGet = false;
  selectedGroups = [{ id: 'north' }];
  groupResultOverride = new Array(groupFilter.GROUP_LIMIT);
  addin.focus(api, state);
  assert.doesNotMatch(element('hos-summary-wrap').innerHTML, /Driver, North|Driver, South/);
  assert.match(element('hos-status').innerHTML, /hierarchy may be incomplete/);
  assert.equal(element('hos-download-btn').disabled, true);

  groupResultOverride = null;
  deferGroupGet = true;
  var pendingBeforeStaleFocus = pendingGroupGets.length;
  selectedGroups = [{ id: 'north' }];
  addin.focus(api, state);
  selectedGroups = [{ id: 'south' }];
  addin.focus(api, state);
  assert.equal(pendingGroupGets.length, pendingBeforeStaleFocus + 2);
  resolvePendingGroup('south');
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, South/);
  resolvePendingGroup('north');
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, South/);
  assert.doesNotMatch(element('hos-summary-wrap').innerHTML, /Driver, North/);

  // Focus can take ownership of the final scope step without leaving the report locked.
  selectedGroups = [{ id: 'north' }];
  element('hos-run-btn').dispatch('click');
  assert.equal(element('hos-run-btn').disabled, true);
  selectedGroups = [{ id: 'south' }];
  addin.focus(api, state);
  assert.equal(element('hos-driver-btn').disabled, true, 'the driver picker stays disabled during report finalization');
  assert.ok(element('hos-driver-list').checkboxes.every(function (checkbox) { return checkbox.disabled; }));
  resolvePendingGroup('south');
  assert.equal(element('hos-run-btn').disabled, false);
  assert.equal(element('hos-download-btn').disabled, false);
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, South/);
  resolvePendingGroup('north');
  assert.match(element('hos-summary-wrap').innerHTML, /Driver, South/);

  // A range change replaces a pending focus refresh instead of leaving stale options enabled.
  selectedGroups = [{ id: 'north' }];
  addin.focus(api, state);
  selectedGroups = [{ id: 'south' }];
  element('hos-preset-select').value = 'thisWeek';
  element('hos-preset-select').dispatch('change');
  assert.equal(pendingGroupGets.length, 2);
  resolvePendingGroup('south');
  resolvePendingGroup('north');
  assert.deepEqual(element('hos-driver-list').checkboxes.map(function (checkbox) { return checkbox.value; }), ['south-driver']);
  assert.equal(element('hos-group-scope').textContent, 'Groups: South');
  assert.equal(element('hos-download-btn').disabled, true);

  deferGroupGet = false;
  failGroupGet = true;
  selectedGroups = [{ id: 'north' }];
  element('hos-run-btn').dispatch('click');
  assert.doesNotMatch(element('hos-summary-wrap').innerHTML, /Driver, North|Driver, South/);
  assert.equal(element('hos-download-btn').disabled, true);
  assert.equal(element('hos-run-btn').disabled, false, 'a scope failure after processing releases report controls');
  assert.equal(element('hos-driver-btn').disabled, true);

  var writesBeforeGroupExportFailure = writeCount;
  element('hos-download-btn').dispatch('click');
  assert.equal(writeCount, writesBeforeGroupExportFailure, 'a Group API error must block workbook creation');
  assert.equal(element('hos-download-btn').disabled, true);

  failGroupGet = false;
  userResultOverride = new Array(50000);
  addin.initialize(api, state, function () {});
  assert.match(element('hos-status').innerHTML, /Unable to load drivers/);
  assert.equal(element('hos-download-btn').disabled, true);
});
