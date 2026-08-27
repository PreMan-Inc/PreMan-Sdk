// `export const usersRouter = Router()`: the declaration and its export in one
// statement, which is how a TypeScript router is normally written.
import { Router } from 'express';

export const usersRouter = Router();

usersRouter.get('/users', (req, res) => res.json([]));
