// The supertest pattern: a router mounted to exercise it, not to expose it. The mount
// path here is the test's own, so reporting it would put a route on the deployed
// server at a path only this file ever used.
const express = require('express');
const request = require('supertest');

const usersRouter = require('../routes/users');

const app = express();

app.use('/test-mount', usersRouter);

app.get('/test-only', (req, res) => res.json({}));

it('answers under the test mount', () => request(app).get('/test-mount/users').expect(200));
