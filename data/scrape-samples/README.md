# Scrape HTML Samples

Static validation reads HTML from this directory.

## Option A: explicit index
Create `index.json`:

```json
{
  "venues": [
    {
      "slug": "hokage",
      "enabled": true,
      "samplePath": "hokage.html",
      "sourceUrl": "https://livehouse-hokage.com/schedule"
    }
  ]
}
```

## Option B: auto-discovery
Drop `*.html` files in this folder. The validator will treat each filename as the venue slug.
