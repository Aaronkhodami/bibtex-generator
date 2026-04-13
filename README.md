# BibTeX Generator

Static web app that converts one or more DOI values into BibTeX entries directly in the browser.

## Live site

After GitHub Pages is enabled, the app will be available at:

https://aaronkhodami.github.io/bibtex-generator/

## Features

- Accepts raw DOIs, DOI URLs, and mixed multiline input
- Normalizes DOI values before lookup
- Fetches metadata from Crossref with DataCite fallback
- Preserves DOI and omits abstract content in generated BibTeX
- Supports multiple DOI lookups in one request

## Local use

Open `index.html` in a browser, or serve the folder with any static file server.

## Deployment

This repository includes a GitHub Actions workflow that deploys the site to GitHub Pages whenever changes are pushed to the `main` branch.

To finish setup on GitHub:

1. Push this project to the `main` branch of `Aaronkhodami/bibtex-generator`.
2. In the repository settings, open Pages.
3. Set the source to `GitHub Actions`.

After the first successful workflow run, the site will be published at the URL above.