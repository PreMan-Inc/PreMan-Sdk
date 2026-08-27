const express = require('express');

const app = express();

app.get('/ping', (req, res) => {
  res.json({ ok: true });
});

module.exports = app;
