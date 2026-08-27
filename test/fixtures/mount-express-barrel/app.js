// The mount names the barrel, not the file that declares the router. Resolution has to
// take the extra hop through routes/index.js to reach routes/users.js.
const express = require('express');

const routes = require('./routes');

const app = express();

app.use('/api', routes);

app.get('/health', (req, res) => res.json({ ok: true }));
