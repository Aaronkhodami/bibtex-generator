const form = document.querySelector("#doi-form");
const input = document.querySelector("#doi-input");
const normalizedDoi = document.querySelector("#normalized-doi");
const metadataSource = document.querySelector("#metadata-source");
const statusMessage = document.querySelector("#status-message");
const output = document.querySelector("#bibtex-output");
const copyButton = document.querySelector("#copy-button");
const submitButton = document.querySelector("#submit-button");

const DOI_PATTERN = /(10\.\d{4,9}\/[\w.()/:;-]+)/i;
const LOOKUP_CONCURRENCY = 4;
const LOOKUP_RETRY_LIMIT = 2;

function normalizeDoi(rawValue) {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    throw new Error("Enter a DOI first.");
  }

  const decoded = decodeURIComponent(trimmed).replace(/[\s<>]/g, "");
  const withoutPrefix = decoded
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^https?:\/\/www\.doi\.org\//i, "");

  const match = withoutPrefix.match(DOI_PATTERN) || decoded.match(DOI_PATTERN);

  if (!match) {
    throw new Error("This does not look like a valid DOI.");
  }

  return match[1].replace(/[.;,]+$/g, "");
}

function splitDoiInput(rawValue) {
  return rawValue
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeDois(rawValue) {
  const parts = splitDoiInput(rawValue);

  if (!parts.length) {
    throw new Error("Enter at least one DOI.");
  }

  return [...new Set(parts.map((part) => normalizeDoi(part)))];
}

function pickFirst(values) {
  return Array.isArray(values) ? values.find(Boolean) : values;
}

function escapeBibtex(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/[{}]/g, (character) => `\\${character}`)
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyFragment(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("")
    .toLowerCase();
}

function cslDateParts(issued) {
  if (!issued) {
    return [];
  }

  if (Array.isArray(issued["date-parts"]) && issued["date-parts"][0]) {
    return issued["date-parts"][0];
  }

  if (typeof issued === "string") {
    return issued.split(/[-/]/).map((part) => Number(part));
  }

  return [];
}

function getYearFromIssued(issued) {
  const year = cslDateParts(issued)[0];
  return Number.isFinite(year) ? String(year) : "";
}

function getMonthFromIssued(issued) {
  const month = cslDateParts(issued)[1];
  return Number.isFinite(month) && month >= 1 && month <= 12 ? String(month) : "";
}

function formatPerson(person) {
  const family = person.family || person.literal || "";
  const given = person.given || "";
  return given ? `${family}, ${given}` : family;
}

function formatPeople(people = []) {
  return people.map(formatPerson).filter(Boolean).join(" and ");
}

function mapCslTypeToBibtex(type) {
  const mappings = {
    article: "article",
    "article-journal": "article",
    "article-magazine": "article",
    "article-newspaper": "article",
    paper: "inproceedings",
    "paper-conference": "inproceedings",
    chapter: "incollection",
    book: "book",
    thesis: "phdthesis",
    dissertation: "phdthesis",
    report: "techreport",
    webpage: "misc",
    post: "misc",
  };

  return mappings[type] || "misc";
}

function buildCitationKey(metadata) {
  const firstAuthor = pickFirst(metadata.author) || pickFirst(metadata.editor) || {};
  const family = slugifyFragment(firstAuthor.family || firstAuthor.literal || "source");
  const year = getYearFromIssued(metadata.issued) || "nodate";
  return `${family}${year}`;
}

function buildBibtexFields(metadata, doi) {
  const entryType = mapCslTypeToBibtex(metadata.type);
  const title = pickFirst(metadata.title) || metadata.title || "Untitled";
  const containerTitle = pickFirst(metadata["container-title"]) || metadata.publisher || "";
  const year = getYearFromIssued(metadata.issued);
  const month = getMonthFromIssued(metadata.issued);
  const fields = [];

  const addField = (name, value) => {
    if (!value) {
      return;
    }

    fields.push(`  ${name} = {${escapeBibtex(value)}}`);
  };

  addField("author", formatPeople(metadata.author));
  addField("editor", formatPeople(metadata.editor));
  addField("title", title);

  if (entryType === "article") {
    addField("journal", containerTitle);
  } else if (entryType === "inproceedings") {
    addField("booktitle", containerTitle);
  } else if (entryType === "incollection") {
    addField("booktitle", containerTitle);
  } else {
    addField("howpublished", containerTitle);
  }

  addField("year", year);
  addField("month", month);
  addField("volume", metadata.volume);
  addField("number", metadata.issue || metadata.number);
  addField("pages", metadata.page || metadata.pages);
  addField("publisher", metadata.publisher);
  addField("doi", doi);

  if (!doi) {
    addField("url", metadata.URL || metadata.url);
  }

  return {
    entryType,
    fields,
  };
}

function buildBibtex(metadata, doi) {
  const citationKey = buildCitationKey(metadata);
  const { entryType, fields } = buildBibtexFields(metadata, doi);
  return `@${entryType}{${citationKey},\n${fields.join(",\n")}\n}`;
}

async function generateBibtexForDoi(doi) {
  const { source, metadata } = await fetchMetadata(doi);
  return {
    doi,
    source,
    bibtex: buildBibtex(metadata, doi),
  };
}

function toCslFromCrossref(message) {
  return {
    type: message.type,
    title: message.title,
    author: message.author,
    editor: message.editor,
    issued: message.issued,
    "container-title": message["container-title"],
    volume: message.volume,
    issue: message.issue,
    page: message.page,
    publisher: message.publisher,
    DOI: message.DOI,
    URL: message.URL,
  };
}

function toCslFromDatacite(data) {
  const attributes = data.data.attributes;
  return {
    type: attributes.types?.bibtex || attributes.types?.resourceTypeGeneral?.toLowerCase() || "misc",
    title: attributes.titles?.map((entry) => entry.title).filter(Boolean),
    author: (attributes.creators || []).map((creator) => {
      if (creator.nameType === "Organizational") {
        return { literal: creator.name };
      }

      return {
        family: creator.familyName || creator.name,
        given: creator.givenName || "",
      };
    }),
    editor: (attributes.contributors || [])
      .filter((contributor) => contributor.contributorType === "Editor")
      .map((editor) => ({
        family: editor.familyName || editor.name,
        given: editor.givenName || "",
      })),
    issued: attributes.publicationYear ? { "date-parts": [[Number(attributes.publicationYear)]] } : null,
    "container-title": attributes.container?.title ? [attributes.container.title] : [],
    volume: attributes.container?.volume,
    issue: attributes.container?.issue,
    page: attributes.container?.firstPage && attributes.container?.lastPage
      ? `${attributes.container.firstPage}-${attributes.container.lastPage}`
      : attributes.container?.firstPage || "",
    publisher: attributes.publisher,
    DOI: attributes.doi,
    URL: attributes.url,
  };
}

function openAlexPages(openAlexWork) {
  const firstPage = openAlexWork.biblio?.first_page;
  const lastPage = openAlexWork.biblio?.last_page;

  if (firstPage && lastPage) {
    return `${firstPage}-${lastPage}`;
  }

  return firstPage || lastPage || "";
}

function toCslFromOpenAlex(work) {
  const doiUrl = work.doi || work.ids?.doi || "";

  return {
    type: work.type,
    title: work.title ? [work.title] : work.display_name ? [work.display_name] : [],
    author: (work.authorships || [])
      .map((authorship) => authorship.raw_author_name || authorship.author?.display_name)
      .filter(Boolean)
      .map((name) => ({ literal: name })),
    editor: [],
    issued: work.publication_year ? { "date-parts": [[Number(work.publication_year)]] } : null,
    "container-title": work.primary_location?.source?.display_name ? [work.primary_location.source.display_name] : [],
    volume: work.biblio?.volume,
    issue: work.biblio?.issue,
    page: openAlexPages(work),
    publisher: work.primary_location?.source?.host_organization_name || work.primary_location?.source?.display_name || "",
    DOI: doiUrl.replace(/^https?:\/\/doi\.org\//i, ""),
    URL: work.primary_location?.landing_page_url || doiUrl,
  };
}

async function fetchCrossrefMetadata(doi) {
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);

  if (!response.ok) {
    throw new Error(`Crossref lookup failed (${response.status}).`);
  }

  const payload = await response.json();
  return {
    source: "Crossref",
    metadata: toCslFromCrossref(payload.message),
  };
}

async function fetchDataciteMetadata(doi) {
  const response = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);

  if (!response.ok) {
    throw new Error(`DataCite lookup failed (${response.status}).`);
  }

  const payload = await response.json();
  return {
    source: "DataCite",
    metadata: toCslFromDatacite(payload),
  };
}

async function fetchOpenAlexMetadata(doi) {
  const response = await fetch(`https://api.openalex.org/works/${encodeURIComponent(`doi:${doi}`)}`);

  if (!response.ok) {
    throw new Error(`OpenAlex lookup failed (${response.status}).`);
  }

  const payload = await response.json();
  return {
    source: "OpenAlex",
    metadata: toCslFromOpenAlex(payload),
  };
}

async function fetchMetadata(doi) {
  try {
    return await fetchCrossrefMetadata(doi);
  } catch (crossrefError) {
    try {
      return await fetchOpenAlexMetadata(doi);
    } catch {
      try {
        return await fetchDataciteMetadata(doi);
      } catch {
        throw crossrefError;
      }
    }
  }
}

function isTransientLookupError(error) {
  const message = String((error && error.message) || "");
  return /\b(408|409|425|429|500|502|503|504)\b/.test(message) || message === "Failed to fetch";
}

async function generateBibtexWithRetry(doi, retriesLeft = LOOKUP_RETRY_LIMIT) {
  try {
    return await generateBibtexForDoi(doi);
  } catch (error) {
    if (!retriesLeft || !isTransientLookupError(error)) {
      throw error;
    }

    return generateBibtexWithRetry(doi, retriesLeft - 1);
  }
}

async function settleDois(dois, worker, concurrency = LOOKUP_CONCURRENCY) {
  const settled = new Array(dois.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < dois.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        settled[currentIndex] = {
          status: "fulfilled",
          value: await worker(dois[currentIndex]),
        };
      } catch (error) {
        settled[currentIndex] = {
          status: "rejected",
          reason: error,
        };
      }
    }
  }

  const workerCount = Math.min(concurrency, dois.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return settled;
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  input.disabled = isBusy;
}

function updateOutput(text) {
  output.textContent = text;
  copyButton.disabled = !text || text === "No citation generated yet.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const dois = normalizeDois(input.value);
    normalizedDoi.textContent = dois.join("\n");
    metadataSource.textContent = "Searching...";
    statusMessage.textContent = `Resolving ${dois.length} DOI${dois.length === 1 ? "" : "s"} and building BibTeX...`;
    updateOutput("Loading metadata...");
    setBusy(true);

    const results = await settleDois(dois, generateBibtexWithRetry);
    const fulfilled = [];
    const rejected = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        fulfilled.push(result.value);
        return;
      }

      rejected.push({
        doi: dois[index],
        error: result.reason,
      });
    });

    if (!fulfilled.length) {
      throw new Error("No DOI could be resolved into BibTeX.");
    }

    const sourceSummary = [...new Set(fulfilled.map((entry) => entry.source))].join(", ");
    metadataSource.textContent = sourceSummary;
    statusMessage.textContent = rejected.length
      ? `Generated ${fulfilled.length} BibTeX entr${fulfilled.length === 1 ? "y" : "ies"}. ${rejected.length} DOI${rejected.length === 1 ? "" : "s"} failed.`
      : `Generated ${fulfilled.length} BibTeX entr${fulfilled.length === 1 ? "y" : "ies"}.`;

    const failureBlock = rejected.length
      ? `\n\n% Failed DOI lookups\n${rejected
          .map(({ doi, error }) => `% ${doi} -> ${(error && error.message) || "Lookup failed."}`)
          .join("\n")}`
      : "";

    updateOutput(`${fulfilled.map((entry) => entry.bibtex).join("\n\n")}${failureBlock}`);
  } catch (error) {
    metadataSource.textContent = "Unavailable";
    statusMessage.textContent = error.message || "Unable to generate BibTeX for this DOI.";
    updateOutput("No citation generated yet.");
  } finally {
    setBusy(false);
  }
});

copyButton.addEventListener("click", async () => {
  const text = output.textContent;

  if (!text || text === "No citation generated yet.") {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    statusMessage.textContent = "BibTeX copied to clipboard.";
  } catch {
    statusMessage.textContent = "Copy failed. Select and copy the BibTeX manually.";
  }
});