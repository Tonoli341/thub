class DomainError(RuntimeError):
    """Errore di dominio destinato all'utente (mappato su HTTP 400 dal handler
    registrato in app.main), da usare al posto di RuntimeError generici che
    finirebbero come 500."""
