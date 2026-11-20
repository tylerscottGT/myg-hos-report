'use strict';

var assert = require('node:assert/strict');
var test = require('node:test');
var groupFilter = require('../v10/group-filter.js');

function makeIndex(groups) {
  var index = groupFilter.indexGroups(groups);
  assert.equal(index.error, undefined);
  return index;
}

var groups = makeIndex([
  { id: 'GroupCompanyId', name: 'Company', children: [{ id: 'north' }, { id: 'south' }] },
  { id: 'north', name: 'North', children: [{ id: 'north-east' }, { id: 'shared' }] },
  { id: 'north-east', name: 'North East', children: [] },
  { id: 'south', name: 'South', children: [{ id: 'shared' }] },
  { id: 'shared', name: 'Shared', children: [] },
  { id: 'unrelated', name: 'Unrelated', children: [{ id: 'missing-unrelated' }] }
]);

test('a selected parent includes descendant memberships, including multiple parent paths', function () {
  var resolved = groupFilter.resolveFilter({ groupId: 'north' }, groups);
  assert.equal(resolved.error, undefined);
  assert.equal(groupFilter.matchesFilter(resolved.condition, ['north-east'], resolved), true);
  assert.equal(groupFilter.matchesFilter(resolved.condition, ['shared'], resolved), true);
  assert.equal(groupFilter.matchesFilter(resolved.condition, ['south'], resolved), false);
});

test('nested advanced filters honor AND and OR and company-root leaf semantics', function () {
  var filter = {
    relation: 'and',
    groupFilterConditions: [
      { groupId: 'GroupCompanyId' },
      { relation: 'or', groupFilterConditions: [{ groupId: 'north' }, { groupId: 'south' }] }
    ]
  };
  var resolved = groupFilter.resolveFilter(filter, groups);
  assert.equal(resolved.universal, false);
  assert.equal(groupFilter.matchesFilter(filter, ['north-east'], resolved), true);
  assert.equal(groupFilter.matchesFilter(filter, ['unrelated'], resolved), false);
  assert.equal(groupFilter.hasUniversalScope({ relation: 'or', groupFilterConditions: [{ groupId: 'GroupCompanyId' }, { groupId: 'north' }] }), true);
  assert.equal(groupFilter.hasUniversalScope({ relation: 'and', groupFilterConditions: [{ groupId: 'GroupCompanyId' }, { groupId: 'north' }] }), false);
});

test('an empty top-level advanced OR means no filter and does not use stale simple state', function () {
  var filter = groupFilter.currentGroupFilter({
    getAdvancedGroupFilter: function () { return { relation: 'Or', groupFilterConditions: [] }; },
    getGroupFilter: function () { return [{ id: 'north' }]; }
  });
  assert.equal(filter.error, undefined);
  assert.equal(filter.condition, null);
  assert.equal(groupFilter.hasUniversalScope(filter.condition), true);
});

test('simple selection falls back when advanced state is absent or null', function () {
  assert.deepEqual(groupFilter.currentGroupFilter({
    getGroupFilter: function () { return [{ id: 'north' }, { id: 'south' }]; }
  }), { condition: { relation: 'or', groupFilterConditions: [{ groupId: 'north' }, { groupId: 'south' }] } });
  assert.deepEqual(groupFilter.currentGroupFilter({
    getAdvancedGroupFilter: function () { return null; },
    getGroupFilter: function () { return []; }
  }), { condition: null });
});

test('missing or throwing host filter APIs fail closed', function () {
  assert.match(groupFilter.currentGroupFilter({}).error, /methods are unavailable/);
  assert.match(groupFilter.currentGroupFilter({ getAdvancedGroupFilter: function () { throw Error('host'); } }).error, /Unable to read/);
});

test('malformed and unsupported filter grammar is rejected', function () {
  var state = function (condition) { return { getAdvancedGroupFilter: function () { return condition; } }; };
  assert.ok(groupFilter.currentGroupFilter(state({ relation: 'Not', groupFilterConditions: [{ groupId: 'north' }] })).error);
  assert.ok(groupFilter.currentGroupFilter(state({ relation: 'or', groupFilterConditions: [{ relation: 'or', groupFilterConditions: [] }] })).error);
  assert.ok(groupFilter.currentGroupFilter(state({ groupId: 12 })).error);
  assert.ok(groupFilter.currentGroupFilter(state({ relation: 'or', groupFilterConditions: 'north' })).error);
  assert.equal(groupFilter.currentGroupFilter(state({ groupId: 'north', metadata: 'host field' })).condition.groupId, 'north');
  assert.equal(groupFilter.currentGroupFilter(state({ relation: 'or', groupFilterConditions: [{ groupId: 'north' }], metadata: 'host field' })).condition.relation, 'or');
  var deeplyNested = { groupId: 'north' };
  for (var i = 0; i < 25; i++) deeplyNested = { relation: 'and', groupFilterConditions: [deeplyNested] };
  assert.match(groupFilter.currentGroupFilter(state(deeplyNested)).error, /too complex/);
});

test('union of company and driver group memberships includes a divergent membership', function () {
  var membership = groupFilter.membershipForDriver({
    companyGroups: [{ id: 'south' }],
    driverGroups: [{ id: 'north-east' }, { id: 'unknown-extra' }]
  });
  var resolved = groupFilter.resolveFilter({ groupId: 'north' }, groups);
  assert.equal(membership.incomplete, false);
  assert.equal(groupFilter.matchesFilter(resolved.condition, membership.ids, resolved), true);
  assert.deepEqual(membership.ids.sort(), ['north-east', 'south', 'unknown-extra']);
});

test('missing group arrays mark membership incomplete; unknown extra IDs are ignored', function () {
  assert.equal(groupFilter.membershipForDriver({ companyGroups: [], driverGroups: null }).incomplete, true);
  assert.equal(groupFilter.membershipForDriver({ companyGroups: [{}], driverGroups: [] }).incomplete, true);
  var resolved = groupFilter.resolveFilter({ groupId: 'north' }, groups);
  assert.equal(groupFilter.matchesFilter(resolved.condition, ['unknown-extra'], resolved), false);
  assert.equal(groupFilter.matchesFilter(resolved.condition, ['north-east', 'unknown-extra'], resolved), true);
});

test('unknown selected groups and selected-subtree corruption fail closed, unrelated corruption does not', function () {
  assert.match(groupFilter.resolveFilter({ groupId: 'missing' }, groups).error, /incomplete/);
  var danglingSelected = makeIndex([
    { id: 'north', children: [{ id: 'missing-child' }] },
    { id: 'unrelated', children: [] }
  ]);
  assert.match(groupFilter.resolveFilter({ groupId: 'north' }, danglingSelected).error, /incomplete/);
  assert.equal(groupFilter.resolveFilter({ groupId: 'north' }, groups).error, undefined);
  var incompleteElsewhere = makeIndex([
    { id: 'north', children: [] },
    { id: 'unrelated', children: null }
  ]);
  assert.equal(groupFilter.resolveFilter({ groupId: 'north' }, incompleteElsewhere).error, undefined);
  assert.match(groupFilter.resolveFilter({ groupId: 'unrelated' }, incompleteElsewhere).error, /incomplete/);
});

test('cycles in a selected subtree fail closed', function () {
  var cyclic = makeIndex([
    { id: 'north', children: [{ id: 'child' }] },
    { id: 'child', children: [{ id: 'north' }] }
  ]);
  assert.match(groupFilter.resolveFilter({ groupId: 'north' }, cyclic).error, /cycle/);
});

test('whole-company scopes bypass group hierarchy and preserve rows with incomplete membership', function () {
  var universal = groupFilter.resolveFilter(null, null);
  var driverMap = { a: { groupMembershipIncomplete: true } };
  var rows = [{ driverId: 'a', value: 'baseline' }];
  assert.deepEqual(groupFilter.filterRows(rows, driverMap, universal, null, false), rows);
  assert.equal(groupFilter.resolveFilter({ groupId: 'GroupCompanyId' }, null).universal, true);
});

test('rows are scoped by group and an explicit selected-driver set, including an empty set', function () {
  var resolved = groupFilter.resolveFilter({ groupId: 'north' }, groups);
  var driverMap = {
    northDriver: { groupMembershipIds: ['north-east'], groupMembershipIncomplete: false },
    southDriver: { groupMembershipIds: ['south'], groupMembershipIncomplete: false }
  };
  var rows = [{ driverId: 'northDriver' }, { driverId: 'southDriver' }];
  assert.deepEqual(groupFilter.filterRows(rows, driverMap, resolved, null, false), [rows[0]]);
  assert.deepEqual(groupFilter.filterRows(rows, driverMap, resolved, { southDriver: true }, true), []);
  assert.deepEqual(groupFilter.filterRows(rows, driverMap, resolved, { northDriver: true }, true), [rows[0]]);
});
