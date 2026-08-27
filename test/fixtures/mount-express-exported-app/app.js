// `var app = module.exports = express()`: a chained assignment. The name nearest the
// `=` is `exports`, a property no later statement can call the app by, so the chain has
// to be walked back to `app` — otherwise this file declares no receiver at all and
// neither its own route nor the router it mounts is ever found.
const express = require('express');

const usersRouter = require('./routes/users');

var app = module.exports = express();

app.use('/api', usersRouter);

app.get('/health', (req, res) => res.json({ ok: true }));
