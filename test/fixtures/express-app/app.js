// Fixture Express app. Every route below is a scanner expectation.
const express = require('express');

const thingsRouter = require('./routes/things');
const { usersRouter } = require('./routes/users');
const { formatUser } = require('./lib/format');

const app = express();

app.use(usersRouter);
app.use(thingsRouter);

app.get('/users/:id', (req, res) => {
  res.json(formatUser(req.params.id));
});

app.delete("/users/:id", (req, res) => {
  res.status(204).end();
});

app.get(`/status`, (req, res) => {
  res.json({ ok: true });
});

app.all('/health', (req, res) => {
  res.status(200).end();
});

module.exports = app;
