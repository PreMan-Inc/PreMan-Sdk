// Only a name assigned from express() carries routes. Every other `.get(` /
// `.delete(` call below belongs to an unrelated object and must be ignored.
const express = require('express');
const app = express();
const cache = new Map();
app.get('/real', handler);
const v = cache.get('some-cache-key');
const r = axios.get('https://api.example.com/v1/remote');
cache.delete('another-key');
