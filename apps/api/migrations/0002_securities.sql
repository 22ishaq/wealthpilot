-- Reference securities with ILLUSTRATIVE prices (pence per unit, not market data).
INSERT INTO securities (symbol, name, asset_class, price_pence, price_date) VALUES
  ('VWRL', 'Vanguard FTSE All-World UCITS ETF',             'equity',    11842, '2026-10-01'),
  ('VUSA', 'Vanguard S&P 500 UCITS ETF',                    'equity',     9215, '2026-10-01'),
  ('ISF',  'iShares Core FTSE 100 UCITS ETF',               'equity',      851, '2026-10-01'),
  ('VMID', 'Vanguard FTSE 250 UCITS ETF',                   'equity',     3364, '2026-10-01'),
  ('EMIM', 'iShares Core MSCI EM IMI UCITS ETF',            'equity',     3082, '2026-10-01'),
  ('EQQQ', 'Invesco EQQQ Nasdaq-100 UCITS ETF',             'equity',    43150, '2026-10-01'),
  ('IGLT', 'iShares Core UK Gilts UCITS ETF',               'bond',       1052, '2026-10-01'),
  ('VGOV', 'Vanguard U.K. Gilt UCITS ETF',                  'bond',       1803, '2026-10-01'),
  ('SLXX', 'iShares Core GBP Corporate Bond UCITS ETF',     'bond',      11925, '2026-10-01'),
  ('INXG', 'iShares GBP Index-Linked Gilts UCITS ETF',      'bond',       1015, '2026-10-01'),
  ('VAGP', 'Vanguard Global Aggregate Bond UCITS ETF GBP Hedged', 'bond', 2110, '2026-10-01'),
  ('IUKP', 'iShares UK Property UCITS ETF',                 'property',    452, '2026-10-01'),
  ('IWDP', 'iShares Developed Markets Property Yield UCITS ETF', 'property', 1840, '2026-10-01'),
  ('SGLN', 'iShares Physical Gold ETC',                     'commodity',  4610, '2026-10-01'),
  ('PHAG', 'WisdomTree Physical Silver',                    'commodity',  2510, '2026-10-01'),
  ('CSH2', 'Amundi Smart Overnight Return GBP UCITS ETF',   'cash',      11080, '2026-10-01');
