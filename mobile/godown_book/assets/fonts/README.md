# Bundled document fonts

`NotoSansDevanagari-Regular.ttf` and `NotoSansDevanagari-Bold.ttf` are
Noto Sans Devanagari by the Noto Project Authors, obtained from Google
Fonts (fonts.google.com/noto/specimen/Noto+Sans+Devanagari) and used
under the SIL Open Font License, Version 1.1 (see OFL.txt).

They are embedded in every generated PDF (see
`lib/core/document_theme/pdf_fonts.dart`) so that Hindi and mixed
Hindi/English text prints instead of empty boxes. Do not rename them
without updating `PdfFonts`.
