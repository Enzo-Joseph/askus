'use strict';

const fs = require('fs');
const path = require('path');

// Tiny JSON-file persistence: the whole database lives in memory and is
// written to disk (debounced) after each change.
const emptyData = () => ({ users: {}, groups: {}, polls: {}, comments: {}, streaks: {}, meta: { dayOffset: 0 } });

function createStore(file) {
  const data = emptyData();
  if (file && fs.existsSync(file)) Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8')));

  let timer = null;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const json = JSON.stringify(data);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, json);
    try {
      fs.renameSync(tmp, file);
    } catch {
      // Synced folders (OneDrive, Dropbox…) sometimes lock the target; fall back to a direct write.
      fs.writeFileSync(file, json);
      fs.rmSync(tmp, { force: true });
    }
  }

  function save() {
    if (!file || timer) return;
    timer = setTimeout(flush, 250);
  }

  return { data, save, flush };
}

module.exports = { createStore, emptyData };
