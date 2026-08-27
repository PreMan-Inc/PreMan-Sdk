// The other half of the loop. Node itself cannot load this pair: whichever
// file is required second sees a half-built module.
const express = require('express');

const a = require('./a');

const b = express.Router();

b.get('/b-route', (req, res) => res.json({}));

b.use('/a', a);

module.exports = b;
