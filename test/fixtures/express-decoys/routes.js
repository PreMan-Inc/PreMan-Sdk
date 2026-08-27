// This file DOES import express and DOES declare a real route. The decoys sit
// beside it, so the import guard alone cannot make this test pass.
const express = require('express');

const app = express();

// app.get('/commented-out', handler)

/* app.post('/block-commented', handler) */

const s = "app.get('/in-a-string')";
const t = 'app.delete("/in-another-string")';

app.get('/real', (req, res) => {
  res.json({ ok: true, s, t });
});
