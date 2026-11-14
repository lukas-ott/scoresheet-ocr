# Scoresheet OCR Lab

A browser benchmark using BenjaminKost/processed_hcs and quantized TrOCR Small.
It reads 12 cropped moves at a time and compares predictions with dataset labels.
This is a crop-level benchmark. A photo-to-PGN workflow will also need alignment,
cell extraction, chess validation, and handling of annotations.

Serve locally with `python3 -m http.server 8000 --directory dist`. Open
`http://localhost:8000`. The browser needs network access to Hugging Face for
samples and model assets and to jsDelivr for the inference runtime.

Dataset credits: BenjaminKost/processed_hcs, derived from the Handwritten Chess
Scoresheet Dataset by Owen Eicher, Denzel Farmer, Yiyan Li, and Nishatul Majid
(CC BY 3.0). See the links in the app footer.
