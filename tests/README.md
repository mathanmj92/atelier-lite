# Tests

```
npm test
```

Uses Node's built-in test runner, so there is nothing extra to install. The tests cover the parts of Atelier Lite that run without a window:

| Area | What is checked |
| --- | --- |
| Colour palettes | Every theme has the same keys in light and dark, and valid colours. |
| Wording clean-up | Cloud-service names are reworded in the bundled apps; file-format markers and credits are kept. |
| File writer | Real `.docx`, `.pptx` and `.xlsx` containers, and `.csv`; Markdown and Forms are refused in Lite. |
| File reader | The text written into a document, deck and sheet comes back out. |
| Vault | Lock and unlock round trip, wrong secret rejected, modification times kept, recovery key accepted in any case and format, weak secrets refused. |

Window behaviour (tabs, Home, Settings, themes) is checked by running the app and driving it over the Chrome DevTools protocol; those scripts are not part of the repository.
