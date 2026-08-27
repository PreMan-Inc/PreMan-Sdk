// Sorts first, so it is admitted before the cap is hit.
const express = require('express');
const app = express();
app.get('/first', (req, res) => res.json({ ok: true }));
module.exports = app;
