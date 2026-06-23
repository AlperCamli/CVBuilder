# CV Font Assets

These files are vendored so live preview, PDF export, and DOCX export can use the same deterministic CV fonts.

| Font | Files | Source | License |
| --- | --- | --- | --- |
| Noto Sans | `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf` | Existing project asset / [Google Noto Fonts](https://github.com/notofonts) | SIL Open Font License |
| Noto Serif | `NotoSerif-Regular.ttf`, `NotoSerif-Bold.ttf` | Existing project asset / [Google Noto Fonts](https://github.com/notofonts) | SIL Open Font License |
| Latin Modern Roman | `LatinModernRoman-Regular.otf`, `LatinModernRoman-Bold.otf` | [CTAN `lm` package](https://ctan.org/pkg/lm) / [TUG Font Catalogue](https://tug.org/FontCatalogue/latinmodernroman/) | GUST Font License |
| New Computer Modern | `NewComputerModern-Regular.otf`, `NewComputerModern-Bold.otf` | [CTAN NewComputerModern](https://ctan.org/pkg/newcomputermodern) / [GNU release archive](https://download.gnu.org.ua/release/newcm/) | GUST Font License |
| Libertinus Serif | `LibertinusSerif-Regular.otf`, `LibertinusSerif-Bold.otf` | [Libertinus GitHub releases](https://github.com/alerque/libertinus/releases/tag/v7.051) | SIL Open Font License |
| Source Serif 4 | `SourceSerif4-Regular.ttf`, `SourceSerif4-Bold.ttf` | [Google Fonts](https://github.com/google/fonts/tree/main/ofl/sourceserif4) | SIL Open Font License |
| Source Sans 3 | `SourceSans3-Regular.ttf`, `SourceSans3-Bold.ttf` | [Google Fonts](https://github.com/google/fonts/tree/main/ofl/sourcesans3) | SIL Open Font License |
| IBM Plex Sans | `IBMPlexSans-Regular.ttf`, `IBMPlexSans-Bold.ttf` | [Google Fonts](https://github.com/google/fonts/tree/main/ofl/ibmplexsans) / IBM Plex | SIL Open Font License |

`Source Serif 4`, `Source Sans 3`, and `IBM Plex Sans` were downloaded as variable fonts and converted into regular and bold static instances with `fontTools.varLib.instancer`.

When adding or replacing a font, update:

- `backend/src/shared/cv-fonts/cv-font-catalog.ts`
- `frontend/src/styles/fonts.css`
- `frontend/public/fonts/cv/`
- `backend/docs/adding-templates.md`
