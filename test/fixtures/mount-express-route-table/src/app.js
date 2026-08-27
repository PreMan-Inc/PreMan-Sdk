// The table's own router is itself mounted, so each endpoint carries three prefixes:
// /v1 from here, the row's prefix from the table, and the path beside the handler.
const express = require('express');

const routes = require('./routes/v1');

const app = express();

app.use('/v1', routes);
