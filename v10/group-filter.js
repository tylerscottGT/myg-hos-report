(function (root, factory) {
  'use strict';

  var helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  else root.HOSGroupFilter = helpers;
})(typeof window !== 'undefined' ? window : {}, function () {
  'use strict';

  var COMPANY_GROUP = 'GroupCompanyId';
  var GROUP_LIMIT = 50000;

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function groupId(value) {
    if (typeof value === 'string') return value;
    return value && typeof value.id === 'string' ? value.id : '';
  }

  function normalizeFilter(condition, isTopLevel, depth, budget) {
    depth = depth || 0;
    budget = budget || { nodes: 0 };
    budget.nodes++;
    if (depth > 20 || budget.nodes > 256) return { error: 'The MyGeotab group filter is too complex.' };
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
      return { error: 'The MyGeotab group filter has an invalid shape.' };
    }

    if (own(condition, 'groupId')) {
      if (typeof condition.groupId !== 'string' || !condition.groupId || own(condition, 'groupFilterConditions') || own(condition, 'relation')) {
        return { error: 'The MyGeotab group filter contains an invalid group condition.' };
      }
      // Ignore non-structural host metadata on a leaf; its groupId is authoritative.
      return { condition: { groupId: condition.groupId } };
    }

    var relation = typeof condition.relation === 'string' ? condition.relation.toLowerCase() : '';
    if (relation !== 'and' && relation !== 'or') {
      return { error: 'The MyGeotab group filter uses an unsupported relation.' };
    }
    if (!Array.isArray(condition.groupFilterConditions)) {
      return { error: 'The MyGeotab group filter conditions are invalid.' };
    }
    // Ignore non-structural host metadata on a branch while validating its grammar.

    var children = condition.groupFilterConditions;
    if (!children.length) {
      if (isTopLevel && relation === 'or') return { condition: null };
      return { error: 'The MyGeotab group filter contains an empty nested condition.' };
    }

    var normalized = [];
    for (var i = 0; i < children.length; i++) {
      var child = normalizeFilter(children[i], false, depth + 1, budget);
      if (child.error) return child;
      normalized.push(child.condition);
    }
    return { condition: { relation: relation, groupFilterConditions: normalized } };
  }

  function currentGroupFilter(pageState) {
    if (!pageState) return { error: 'MyGeotab group-filter state is unavailable.' };

    var advanced = null;
    try {
      if (typeof pageState.getAdvancedGroupFilter === 'function') {
        advanced = pageState.getAdvancedGroupFilter();
      }
    } catch (e) {
      return { error: 'Unable to read the MyGeotab advanced group filter.' };
    }

    if (advanced !== null && advanced !== undefined) {
      return normalizeFilter(advanced, true);
    }

    if (typeof pageState.getGroupFilter !== 'function') {
      return { error: 'MyGeotab group-filter methods are unavailable.' };
    }
    var simple;
    try {
      simple = pageState.getGroupFilter();
    } catch (e2) {
      return { error: 'Unable to read the MyGeotab group filter.' };
    }
    if (!Array.isArray(simple)) return { error: 'The MyGeotab group filter is invalid.' };
    if (!simple.length) return { condition: null };

    var conditions = [];
    for (var i = 0; i < simple.length; i++) {
      var id = groupId(simple[i]);
      if (!id) return { error: 'The MyGeotab group filter contains an invalid group.' };
      conditions.push({ groupId: id });
    }
    return { condition: { relation: 'or', groupFilterConditions: conditions } };
  }

  function indexGroups(groups) {
    if (!Array.isArray(groups)) return { error: 'The MyGeotab group list is invalid.' };
    var byId = Object.create(null);
    var sourceById = Object.create(null);

    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      if (!group || typeof group.id !== 'string' || !group.id) {
        return { error: 'The MyGeotab group hierarchy contains an invalid group.' };
      }
      if (own(byId, group.id)) return { error: 'The MyGeotab group hierarchy contains duplicate groups.' };
      byId[group.id] = { id: group.id, name: group.name || '', children: [], childrenComplete: Array.isArray(group.children) };
      sourceById[group.id] = group;
    }

    Object.keys(byId).forEach(function (id) {
      var group = sourceById[id];
      (Array.isArray(group.children) ? group.children : []).forEach(function (child) {
        byId[id].children.push(groupId(child));
      });
    });
    return { byId: byId };
  }

  function descendantsForGroup(id, groupIndex) {
    if (id === COMPANY_GROUP) return { ids: null };
    var result = Object.create(null);
    var visiting = Object.create(null);
    var visited = Object.create(null);
    var error = null;
    var stack = [{ id: id, exiting: false }];
    while (stack.length && !error) {
      var item = stack.pop();
      var currentId = item.id;
      if (item.exiting) {
        delete visiting[currentId];
        visited[currentId] = true;
        continue;
      }
      if (visiting[currentId]) {
        error = 'The selected MyGeotab group hierarchy contains a cycle.';
        break;
      }
      if (visited[currentId]) continue;
      var group = groupIndex.byId[currentId];
      if (!group) {
        error = 'The selected MyGeotab group hierarchy is incomplete.';
        break;
      }
      if (!group.childrenComplete) {
        error = 'The selected MyGeotab group hierarchy is incomplete.';
        break;
      }
      visiting[currentId] = true;
      result[currentId] = true;
      stack.push({ id: currentId, exiting: true });
      for (var i = group.children.length - 1; i >= 0; i--) stack.push({ id: group.children[i], exiting: false });
    }
    return error ? { error: error } : { ids: result };
  }

  function groupIds(condition, result) {
    result = result || [];
    if (!condition) return result;
    if (condition.groupId) {
      if (result.indexOf(condition.groupId) === -1) result.push(condition.groupId);
      return result;
    }
    (condition.groupFilterConditions || []).forEach(function (child) { groupIds(child, result); });
    return result;
  }

  function hasUniversalScope(condition) {
    if (!condition) return true;
    if (condition.groupId) return condition.groupId === COMPANY_GROUP;
    var children = condition.groupFilterConditions || [];
    if (condition.relation === 'or') return children.some(hasUniversalScope);
    return children.length > 0 && children.every(hasUniversalScope);
  }

  function resolveFilter(condition, groupIndex) {
    if (hasUniversalScope(condition)) return { universal: true, condition: condition, descendants: Object.create(null) };
    var leaves = Object.create(null);
    var ids = groupIds(condition);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === COMPANY_GROUP) continue;
      var descendants = descendantsForGroup(ids[i], groupIndex);
      if (descendants.error) return descendants;
      leaves[ids[i]] = descendants.ids;
    }
    return { universal: false, condition: condition, descendants: leaves };
  }

  function matchesFilter(condition, membershipIds, resolved) {
    if (!condition) return true;
    if (condition.groupId) {
      if (condition.groupId === COMPANY_GROUP) return true;
      var descendants = resolved.descendants[condition.groupId] || Object.create(null);
      return membershipIds.some(function (id) { return descendants[id] === true; });
    }
    var children = condition.groupFilterConditions || [];
    if (condition.relation === 'and') return children.every(function (child) { return matchesFilter(child, membershipIds, resolved); });
    return children.some(function (child) { return matchesFilter(child, membershipIds, resolved); });
  }

  function membershipForDriver(driver) {
    if (!driver || !Array.isArray(driver.companyGroups) || !Array.isArray(driver.driverGroups)) {
      return { ids: [], incomplete: true };
    }
    // These are both documented Driver group dimensions. The union is deliberate;
    // the top-bar filter scopes presentation only and does not change API permissions.
    var seen = Object.create(null);
    var incomplete = false;
    driver.companyGroups.concat(driver.driverGroups).forEach(function (group) {
      var id = groupId(group);
      if (id) seen[id] = true;
      else incomplete = true;
    });
    return { ids: Object.keys(seen), incomplete: incomplete };
  }

  function groupName(id, groupIndex) {
    var group = groupIndex && groupIndex.byId[id];
    return (group && group.name) || id.replace(/^Group|Id$/g, '');
  }

  function filterRows(rows, driverMap, resolved, selectedDriverIds, selectionActive) {
    if (!resolved) return [];
    return (rows || []).filter(function (row) {
      var driver = driverMap && driverMap[row.driverId];
      if (!driver) return false;
      if (selectionActive && (!selectedDriverIds || selectedDriverIds[row.driverId] !== true)) return false;
      if (resolved.universal) return true;
      if (driver.groupMembershipIncomplete) return false;
      return matchesFilter(resolved.condition, driver.groupMembershipIds || [], resolved);
    });
  }

  return {
    GROUP_LIMIT: GROUP_LIMIT,
    currentGroupFilter: currentGroupFilter,
    descendantsForGroup: descendantsForGroup,
    filterRows: filterRows,
    groupIds: groupIds,
    groupName: groupName,
    hasUniversalScope: hasUniversalScope,
    indexGroups: indexGroups,
    membershipForDriver: membershipForDriver,
    matchesFilter: matchesFilter,
    resolveFilter: resolveFilter
  };
});
