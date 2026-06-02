"""Self-contained read-only REST API over collected Nutanix Prism data.

This package is intentionally decoupled from the ``collector`` package so it can
be imported and run without triggering the gRPC collector's import-time side
effects (env var requirements, file cleanup, port binding checks).
"""
