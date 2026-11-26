SAFAR EDGE - User-defined MROUND multiples

Replace:
home/static/js/cad/io/cad-measurement-takeoff.js

Measurement Settings now accepts positive decimal multiples rather than whole-number decimal-place counts.
Examples: 0.001, 0.005, 0.01, 0.05, 0.002.

Measurement MROUND Multiple applies to Length and Width in the selected output length unit.
Quantity MROUND Multiple applies to Quantity in the selected output area unit.

The previous decimal-place preferences are migrated automatically:
measurement 3 decimal places -> 0.001
quantity 2 decimal places -> 0.01

MROUND remains the only rounding method. Spreadsheet values remain numeric, with display precision derived from the entered multiple.
