<p align="center">
<img width="233" height="340" alt="logo (1)" src="https://github.com/user-attachments/assets/cda07dc0-c736-4bc2-b466-ef59fff65c9a" />
</p>


# bqcheck

Know what a BigQuery query costs before you run it. Highlight SQL anywhere in Chrome, click the extension, see the bill.

Runs entirely on your machine via a small local server and a Chrome extension. Uses your existing `gcloud` creds.

## Setup

You'll need Python 3.11+, [uv](https://docs.astral.sh/uv/), and `gcloud` signed in:

```
gcloud auth application-default login
gcloud auth login
```

Start the server:

```
cd server
uv sync
uv run bqcheck-server
```

Load the extension:

1. Open `chrome://extensions` and turn on **Developer mode**
2. **Load unpacked** → pick the `extension/` folder
3. Pin it to the toolbar

## Using it

Three ways to check a query:

- **Popup** : highlight SQL, click the icon. The selection drops into the editor — pick a project, hit **Calculate Cost**. You can also paste SQL directly.
- **Right-click** : select SQL → **Check BQ cost**. Result shows on the toolbar badge; the popup never opens.
- **Keyboard** : `Cmd+Shift+,` (mac) / `Ctrl+Shift+,` (Win/Linux) with SQL selected. Same badge-only flow as the right-click menu. Rebind at `chrome://extensions/shortcuts`.

Click the ⚙ to set your org's price per TiB (defaults to `$6.25`).

## Also

There's a CLI if you want a one-off estimate from the terminal:

```
uv run bqcheck query.sql --project my-proj
```

Server flags: `--port 7899` (also update `manifest.json`'s `host_permissions` and the `SERVER` constant in `extension/shared.js`), `--project my-proj` for a default fallback.

## When things break

- **`ERR` on the badge** : server isn't running.
- **Empty project dropdown** : `gcloud auth login` then hit ↻.
- **403 from BigQuery** : your ADC user needs `BigQuery Job User` on that project.

## License

MIT. See [LICENSE](LICENSE).
