// An array of paths is not one mount but several: Express answers on every path in
// it, so both prefixes are real and both are readable. Nothing here is uncertain.
const express = require('express');

const usersRouter = require('./routes/users');

const app = express();

app.use(['/api', '/v2'], usersRouter);
