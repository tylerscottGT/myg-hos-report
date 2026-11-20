'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var test = require('node:test');

var root = path.join(__dirname, '..');

test('v10 uses its own helper and only references the shared root spreadsheet library', function () {
  var page = fs.readFileSync(path.join(root, 'v10', 'index.html'), 'utf8');
  var config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

  assert.match(page, /src="\.\/group-filter\.js\?v=10"/);
  assert.match(page, /src="\.\.\/xlsx\.full\.min\.js"/);
  assert.match(config.items[0].url, /\/v10\/index\.html\?v=10$/);
});

test('the existing root v9 page is not wired to the new group-filter helper', function () {
  var page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(page, /group-filter\.js/);
  assert.match(page, /src="\.\/xlsx\.full\.min\.js"/);
});
