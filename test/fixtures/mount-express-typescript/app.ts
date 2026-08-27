// The specifier says './routes/users.js' and the file on disk is routes/users.ts.
// Under NodeNext that is not a mistake but the required spelling — this repo's own
// source is written the same way — so resolution has to follow the .js name to the
// .ts file or the mount is lost and /users reports at the root.
import express from 'express';

import { usersRouter } from './routes/users.js';

const app = express();

app.use('/api', usersRouter);

app.get('/health', (req, res) => res.json({ ok: true }));
