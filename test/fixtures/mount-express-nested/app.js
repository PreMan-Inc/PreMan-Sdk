// Pins a two-level mount chain: /api here, /users in v1.js.
const express = require('express');

const v1 = require('./v1');

const app = express();

app.use('/api', v1);

app.get('/health', (req, res) => res.json({ ok: true }));
