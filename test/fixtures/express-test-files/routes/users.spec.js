// A test sitting beside the code it covers. No directory name catches this file, and
// it is the more common shape of the two. It mounts the router bare and declares a
// route of its own; neither may reach the output.
const express = require('express');
const request = require('supertest');

const usersRouter = require('./users');

const app = express();

app.use('/', usersRouter);

app.get('/spec-only', (req, res) => res.json({}));

it('lists users', () => request(app).get('/users').expect(200));
