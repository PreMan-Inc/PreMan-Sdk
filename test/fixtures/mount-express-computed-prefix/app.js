// Two prefixes that begin with a readable literal and state a value, not a path.
// Concatenation mounts at /api/v2, so reading '/api/' alone reports a path nothing
// serves; a template literal mounts at a fixed segment the server serves literally,
// so naming it {version} invites a caller to substitute into a hole that is not there.
const express = require('express');

const reportsRouter = require('./routes/reports');
const auditRouter = require('./routes/audit');

const version = process.env.API_VERSION;

const app = express();

app.use('/api/' + version, reportsRouter);

app.use(`/api/${version}`, auditRouter);

app.get('/health', (req, res) => res.json({ ok: true }));
