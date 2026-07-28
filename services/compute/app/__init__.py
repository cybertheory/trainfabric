# trainfabric compute package (Hermes + tf CLI + FastAPI app).
# Keep this lightweight so Box golden images can import app.hermes / app.tf_cli
# without pulling FastAPI/uvicorn via `import app`.
__all__: list[str] = []
