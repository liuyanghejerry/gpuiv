These six native TrueType faces retain the outlines and advance metrics from
animal-island-vue's `demo/html/fonts/*.woff`. No font data is downloaded by the
converter. Fontsource supplies the original Nunito 500/700/900 Latin faces and
Noto Sans SC 400/500/700 Chinese Simplified faces. The latter already contain
every code point in the matching Latin subsets, so they are retained whole;
there is no glyph merge.

The native families are `Animal Island Nunito` and `Animal Island Noto Sans SC`.
The original web subsets use inconsistent native names (`Nunito Medium`,
`Nunito Black`, and `Noto Sans SC Thin`); the converter normalizes family,
subfamily, full and PostScript names while preserving each OS/2 weight. The
prefix identifies these modified font files and avoids using Adobe's reserved
font name `Source`. Copyright records remain embedded, and the full OFL 1.1 is
also embedded in each face.

Licences are copied from the primary Google Fonts repository and agree with
the originals' embedded copyright and OFL URL:

- [Nunito OFL](https://github.com/google/fonts/blob/main/ofl/nunito/OFL.txt)
- [Noto Sans SC OFL](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt)

The fonts remain under SIL OFL 1.1, independently of the component library's
MIT licence. Keep both `*-OFL.txt` files when redistributing the assets.
`sources.json` records original and generated hashes, names, coverage and the
conversion tool version.

To reproduce, install `fonttools==4.66.1` in an isolated environment and run:

```sh
python convert.py /path/to/animal-island-vue/demo/html/fonts
```

Register the faces with `loadAnimalIslandFonts(renderer)` in the app's root
setup before it renders text. That helper leaves `fonts.sans` on the system
default until registration succeeds. CJK fallback for ordinary `<text>` follows
the platform cascade; this package does not add a renderer-wide fallback API.
