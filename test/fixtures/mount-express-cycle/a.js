// Half of a mount loop: a mounts b, and b mounts a back. Resolution must
// terminate and report the edge that closed the loop.
const express = require('express');

const b = require('./b');

const a = express.Router();

a.get('/a-route', (req, res) => res.json({}));

a.use('/b', b);

module.exports = a;
