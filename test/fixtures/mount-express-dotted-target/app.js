// `app.use('/api', routes.usersRouter)`: a dotted target read off a whole-module
// require. The property names the router, so the mount resolves to it alone.
const express = require('express');

const routes = require('./routes');

const app = express();

app.use('/api', routes.usersRouter);
