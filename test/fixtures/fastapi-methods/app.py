from fastapi import FastAPI

app = FastAPI()


@app.api_route("/brew", methods=["BREW", "GET"])
def brew():
    return {"teapot": True}
