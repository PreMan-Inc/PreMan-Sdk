"""Module docstring. This file DOES import fastapi and DOES declare a real
route, so the import guard alone cannot make the test pass.

Decoy in a docstring: @app.get('/in-a-module-docstring')
"""

from fastapi import FastAPI

app = FastAPI()

# @app.post('/commented-out')
# @app.delete('/also-commented-out')


@app.get("/real")
def real():
    """Handler docstring decoy: @app.put('/in-a-handler-docstring')"""
    return {"ok": True}
