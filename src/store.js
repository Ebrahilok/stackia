'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** File-backed storage. Everything the app knows is a plain file under one directory. */
class Store {
  constructor(dir) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  resolve(rel) {
    const full = path.resolve(this.dir, rel);
    if (full !== this.dir && !full.startsWith(this.dir + path.sep)) throw new Error(`Path escapes store: ${rel}`);
    return full;
  }

  readText(rel, fallback = '') {
    try {
      return fs.readFileSync(this.resolve(rel), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  writeText(rel, text) {
    const full = this.resolve(rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, full);
  }

  readJson(rel, fallback) {
    const text = this.readText(rel, null);
    return text === null ? fallback : JSON.parse(text);
  }

  writeJson(rel, value) {
    this.writeText(rel, JSON.stringify(value, null, 2) + '\n');
  }

  append(rel, line) {
    const full = this.resolve(rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.appendFileSync(full, line + '\n');
  }

  list(rel) {
    try {
      return fs.readdirSync(this.resolve(rel));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  exists(rel) {
    return fs.existsSync(this.resolve(rel));
  }
}

module.exports = { Store };
