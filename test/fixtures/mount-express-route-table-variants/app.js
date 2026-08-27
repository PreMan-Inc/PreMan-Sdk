const express = require('express');

const keyed = require('./routes/keyed');
const looped = require('./routes/looped');

const app = express();

app.use('/keyed', keyed);

app.use('/looped', looped);
