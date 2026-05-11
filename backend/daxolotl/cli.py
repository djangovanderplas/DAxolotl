"""DAxolotl CLI."""

from pathlib import Path
from typing import Annotated

import typer

app = typer.Typer(help="DAxolotl test-data tools.")


@app.command()
def version() -> None:
    """Print the DAxolotl version."""
    from daxolotl import __version__

    typer.echo(__version__)


@app.command()
def ingest(
    path: Annotated[
        Path, typer.Argument(help="A .tdms file or a directory containing one .tdms file.")
    ],
    name: Annotated[
        str | None, typer.Option("--name", "-n", help="Override the dataset name.")
    ] = None,
    group_id: Annotated[
        int | None, typer.Option("--group-id", help="Assign the dataset to a group.")
    ] = None,
) -> None:
    """Load a TDMS file into SQLite and write its parquet cache."""
    from daxolotl import db as db_module
    from daxolotl.ingest import ingest_file, resolve_ingest_path
    from daxolotl.models import User

    try:
        source_path = resolve_ingest_path(path)
    except (FileNotFoundError, ValueError) as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1) from exc

    db_module.init_db()
    with db_module.SessionLocal() as db:
        user = db.query(User).filter_by(email="dev@local").first()
        if user is None:
            typer.echo("Error: dev user was not seeded", err=True)
            raise typer.Exit(1)
        try:
            dataset = ingest_file(
                source_path, db=db, owner_id=user.id, name=name, group_id=group_id
            )
        except (FileNotFoundError, ValueError) as exc:
            typer.echo(f"Error: {exc}", err=True)
            raise typer.Exit(1) from exc

    typer.echo(f"Ingested dataset {dataset.id}: {dataset.name}")
    typer.echo(f"Raw: {dataset.raw_path}")
    typer.echo(f"Processed: {dataset.processed_path}")


if __name__ == "__main__":
    app()
