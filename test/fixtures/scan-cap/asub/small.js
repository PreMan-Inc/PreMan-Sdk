const express = require('express');
const r = express.Router();
r.get('/sub', (req, res) => res.end());
module.exports = r;
