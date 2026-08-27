// Pins a router mounted at two prefixes: one endpoint in, two endpoints out.
const express = require('express');

const pingRouter = require('./routes/ping');

const app = express();

app.use('/api', pingRouter);

app.use('/internal', pingRouter);
